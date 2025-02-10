import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
const syncLatencyTrend = new Trend('sync_latency');
const asyncDirectLatencyTrend = new Trend('async_direct_latency');
const asyncEventLatencyTrend = new Trend('async_event_latency');

const syncErrors = new Rate('sync_errors');
const asyncDirectErrors = new Rate('async_direct_errors');
const asyncEventErrors = new Rate('async_event_errors');

const successfulOrders = new Counter('successful_orders');
const failedOrders = new Counter('failed_orders');

const asyncDirectE2ELatency = new Trend('async_direct_e2e_latency');
const asyncEventE2ELatency = new Trend('async_event_e2e_latency');

export const options = {
  scenarios: {
    sync_test: {
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
      startTime: '2m30s'
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
      startTime: '5m'
    }
  },
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    http_req_failed: ['rate<0.01'],
    'sync_latency': ['p(95)<1000', 'avg<500'],
    'async_direct_e2e_latency': ['p(95)<2000', 'avg<1000'],
    'async_event_e2e_latency': ['p(95)<3000', 'avg<1500'],
    'successful_orders': ['count>100'],
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
    quantity: Math.floor(Math.random() * 2) + 1
  });
}

function waitForOrderConfirmationSSE(orderId) {
  const MAX_DURATION = 5000;

  return new Promise((resolve) => {
    const response = http.get(`${BASE_URL}/orders/stream/${orderId}`, {
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      timeout: MAX_DURATION,
    });

    if (response.status === 200) {
      const events = response.body.split('\n\n');
      
      for (const event of events) {
        if (event.startsWith('data: ')) {
          const data = JSON.parse(event.slice(6));
          if (data.status === 'confirmed') return resolve(true);
          if (data.status === 'failed') return resolve(false);
        }
      }
    }

    resolve(false);
  });
}

function handleAsyncResponse(response, startTime, latencyTrend, e2eLatencyTrend, errorRate, patternName) {
  // Measure initial response time
  const initialDuration = response.timings.duration;
  latencyTrend.add(initialDuration);

  const success = response.status === 201 || response.status === 200;
  
  if (!success) {
    errorRate.add(true);
    failedOrders.add(1);
    console.error(`${patternName} failed: Status ${response.status}, Body: ${response.body}`);
    return false;
  }

  // Get order ID from response
  const order = JSON.parse(response.body);
  
  // Wait for order confirmation
  const confirmed = waitForOrderConfirmationSSE(order.id);
  
  // Calculate total end-to-end time
  const totalDuration = new Date() - startTime;
  e2eLatencyTrend.add(totalDuration);

  if (confirmed) {
    successfulOrders.add(1);
    errorRate.add(false);
  } else {
    failedOrders.add(1);
    errorRate.add(true);
  }

  return check(response, {
    [`${patternName} status 2xx`]: () => success,
    [`${patternName} order confirmed`]: () => confirmed,
    [`${patternName} response valid`]: (r) => r.status !== 0,
  });
}

export function syncTest() {
  const payload = getTestPayload();
  const response = http.post(`${BASE_URL}/orders/sync`, payload, {
    headers: HEADERS,
    timeout: '10s'
  });

  const success = response.status === 201 || response.status === 200;
  syncErrors.add(!success);
  
  if (success) {
    successfulOrders.add(1);
    syncLatencyTrend.add(response.timings.duration);
  } else {
    failedOrders.add(1);
  }

  sleep(1);
}

export function asyncDirectTest() {
  const startTime = new Date();
  const payload = getTestPayload();
  const response = http.post(`${BASE_URL}/orders/async-direct`, payload, {
    headers: HEADERS,
    timeout: '10s'
  });

  handleAsyncResponse(
    response,
    startTime,
    asyncDirectLatencyTrend,
    asyncDirectE2ELatency,
    asyncDirectErrors,
    'async-direct'
  );
  
  sleep(1);
}

export function asyncEventTest() {
  const startTime = new Date();
  const payload = getTestPayload();
  const response = http.post(`${BASE_URL}/orders/async-event`, payload, {
    headers: HEADERS,
    timeout: '15s'
  });

  handleAsyncResponse(
    response,
    startTime,
    asyncEventLatencyTrend,
    asyncEventE2ELatency,
    asyncEventErrors,
    'async-event'
  );
  
  sleep(2);
}

export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data),
  };
}