import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const syncLatencyTrend = new Trend('sync_latency');
const asyncDirectLatencyTrend = new Trend('async_direct_latency');
const asyncEventLatencyTrend = new Trend('async_event_latency');

const syncErrors = new Rate('sync_errors');
const asyncDirectErrors = new Rate('async_direct_errors');
const asyncEventErrors = new Rate('async_event_errors');

// Add success counters
const successfulOrders = new Counter('successful_orders');
const failedOrders = new Counter('failed_orders');

export const options = {
  scenarios: {
    sync_test: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 5,
      maxVUs: 10,
      stages: [
        { duration: '30s', target: 5 },  // Ramp-up
        { duration: '1m', target: 5 },   // Steady load
        { duration: '30s', target: 0 },  // Scale down
      ],
      exec: 'syncTest',
    },
    async_direct_test: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 5,
      maxVUs: 10,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 5 },
        { duration: '30s', target: 0 },
      ],
      exec: 'asyncDirectTest',
      startTime: '2m30s'  // Start after sync test completes
    },
    async_event_test: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 5,
      maxVUs: 10,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 5 },
        { duration: '30s', target: 0 },
      ],
      exec: 'asyncEventTest',
      startTime: '5m'  // Start after async-direct test completes
    }
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<3000'],
    http_req_failed: ['rate<0.01'],  // Less than 1% errors
    'sync_latency': ['p(95)<1000', 'avg<500'],
    'async_direct_latency': ['p(95)<1500', 'avg<750'],
    'async_event_latency': ['p(95)<2000', 'avg<1000'],
    'successful_orders': ['count>100'],  // Minimum successful orders
    'sync_errors': ['rate<0.01'],
    'async_direct_errors': ['rate<0.01'],
    'async_event_errors': ['rate<0.01'],
  },
};

const BASE_URL = 'http://localhost:3000';
const HEADERS = { 
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

const PRODUCTS = ['product-1', 'product-2', 'product-3'];

function getTestPayload() {
  return JSON.stringify({
    productId: PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)],
    quantity: Math.floor(Math.random() * 2) + 1  // Random 1-2 quantity
  });
}

function handleResponse(response, latencyTrend, errorRate, patternName) {
  const duration = response.timings.duration;
  latencyTrend.add(duration);

  const success = response.status === 201 || response.status === 200;
  errorRate.add(!success);

  if (success) {
    successfulOrders.add(1);
  } else {
    failedOrders.add(1);
    console.error(`${patternName} failed: Status ${response.status}, Body: ${response.body}`);
  }

  return check(response, {
    [`${patternName} status 2xx`]: () => success,
    [`${patternName} response valid`]: (r) => r.status !== 0,
    [`${patternName} response has data`]: (r) => r.json() !== null,
  });
}

export function syncTest() {
  const payload = getTestPayload();
  const response = http.post(`${BASE_URL}/orders/sync`, payload, {
    headers: HEADERS,
    timeout: '10s'
  });

  handleResponse(response, syncLatencyTrend, syncErrors, 'sync');
  sleep(1);
}

export function asyncDirectTest() {
  const payload = getTestPayload();
  const response = http.post(`${BASE_URL}/orders/async-direct`, payload, {
    headers: HEADERS,
    timeout: '10s'
  });

  handleResponse(response, asyncDirectLatencyTrend, asyncDirectErrors, 'async-direct');
  sleep(1);
}

export function asyncEventTest() {
  const payload = getTestPayload();
  const response = http.post(`${BASE_URL}/orders/async-event`, payload, {
    headers: HEADERS,
    timeout: '15s'  // Longer timeout for event processing
  });

  handleResponse(response, asyncEventLatencyTrend, asyncEventErrors, 'async-event');
  sleep(2);  // Longer sleep for event processing
}

export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data),  // Write JSON summary
  };
}