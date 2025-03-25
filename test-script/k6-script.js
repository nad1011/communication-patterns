import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const syncLatencyTrend = new Trend('sync_latency');
const asyncDirectLatencyTrend = new Trend('async_direct_latency');
const syncErrors = new Rate('sync_errors');
const asyncDirectErrors = new Rate('async_direct_errors');
const successfulOrders = new Counter('successful_orders');
const failedOrders = new Counter('failed_orders');
const asyncDirectE2ELatency = new Trend('async_direct_e2e_latency');

const syncPaymentLatencyTrend = new Trend('sync_payment_latency');
const asyncPaymentLatencyTrend = new Trend('async_payment_latency');
const syncPaymentErrors = new Rate('sync_payment_errors');
const asyncPaymentErrors = new Rate('async_payment_errors');
const successfulPayments = new Counter('successful_payments');
const failedPayments = new Counter('failed_payments');
const asyncPaymentE2ELatency = new Trend('async_payment_e2e_latency');
const asyncPaymentProcessingLatency = new Trend('async_payment_processing_latency');

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
    
    sync_payment_test: {
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
      exec: 'syncPaymentTest',
      startTime: '5m'
    },
    async_payment_test: {
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
      exec: 'asyncPaymentTest',
      startTime: '7m30s'
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    http_req_failed: ['rate<0.01'],

    'sync_latency': ['p(95)<1000', 'avg<500'],
    'async_direct_e2e_latency': ['p(95)<2000', 'avg<1000'],
    'successful_orders': ['count>100'],
    
    'sync_payment_latency': ['p(95)<3000', 'avg<2500'],
    'async_payment_e2e_latency': ['p(95)<4000', 'avg<3000'],
    'async_payment_processing_latency': ['p(95)<3000', 'avg<2500'],
    'successful_payments': ['count>50'],
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
          if (data.status === 'confirmed' || data.status === 'paid') return resolve(true);
          if (data.status === 'failed' || data.status === 'payment_failed') return resolve(false);
        }
      }
    }

    resolve(false);
  });
}

// Thêm hàm mới để đợi trạng thái thanh toán cập nhật
function waitForPaymentCompletion(orderId) {
  const MAX_TRIES = 10;
  const INTERVAL = 500; // ms
  
  for(let i = 0; i < MAX_TRIES; i++) {
    const statusResponse = http.get(`${BASE_URL}/orders/status/${orderId}`, {
      headers: HEADERS,
    });
    
    if(statusResponse.status === 200) {
      const orderData = JSON.parse(statusResponse.body);
      // Kiểm tra nếu trạng thái đã cập nhật
      if(orderData.status === 'paid' || orderData.paymentStatus === 'completed') {
        return true;
      }
      if(orderData.status === 'payment_failed' || orderData.paymentStatus === 'failed') {
        return false;
      }
    }
    
    sleep(INTERVAL/1000); // k6 sleep nhận giây
  }
  
  return false; // Quá thời gian đợi vẫn không có kết quả
}

function handleAsyncResponse(response, startTime, latencyTrend, e2eLatencyTrend, errorRate, patternName) {
  const initialDuration = response.timings.duration;
  latencyTrend.add(initialDuration);

  const success = response.status === 201 || response.status === 200;
  
  if (!success) {
    errorRate.add(true);
    failedOrders.add(1);
    console.error(`${patternName} failed: Status ${response.status}, Body: ${response.body}`);
    return false;
  }

  const order = JSON.parse(response.body);
  
  const confirmed = waitForOrderConfirmationSSE(order.id);
  
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

function handlePaymentResponse(response, startTime, latencyTrend, e2eLatencyTrend, errorRate, patternName) {
  const initialDuration = response.timings.duration;
  latencyTrend.add(initialDuration);

  const success = response.status === 201 || response.status === 200;
  
  if (!success) {
    errorRate.add(true);
    failedPayments.add(1);
    console.error(`${patternName} failed: Status ${response.status}, Body: ${response.body}`);
    return false;
  }

  const paymentData = JSON.parse(response.body);
  const orderId = paymentData.orderId;
  
  const processingStartTime = new Date();
  const paymentCompleted = waitForPaymentCompletion(orderId);
  const processingDuration = new Date() - processingStartTime;
  
  asyncPaymentProcessingLatency.add(processingDuration);
  
  const totalDuration = new Date() - startTime;
  e2eLatencyTrend.add(totalDuration);

  if (paymentCompleted) {
    successfulPayments.add(1);
    errorRate.add(false);
  } else {
    failedPayments.add(1);
    errorRate.add(true);
  }

  return check(response, {
    [`${patternName} status 2xx`]: () => success,
    [`${patternName} payment initiated`]: () => 
      paymentData.status === 'payment_pending' || 
      paymentData.message === 'Payment processing initiated',
    [`${patternName} payment completed`]: () => paymentCompleted,
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

export function syncPaymentTest() {
  const orderPayload = getTestPayload();
  const orderResponse = http.post(`${BASE_URL}/orders/sync`, orderPayload, {
    headers: HEADERS,
    timeout: '10s'
  });
  
  if (orderResponse.status !== 200 && orderResponse.status !== 201) {
    console.error(`Failed to create order: ${orderResponse.status}`);
    failedPayments.add(1);
    syncPaymentErrors.add(true);
    return;
  }
  
  const order = JSON.parse(orderResponse.body);
  
  const paymentPayload = JSON.stringify({
    orderId: order.id,
    quantity: Math.floor(Math.random() * 100) + 50,
    currency: 'USD'
  });
  
  const response = http.post(`${BASE_URL}/orders/payment/sync`, paymentPayload, {
    headers: HEADERS,
    timeout: '10s'
  });

  const success = response.status === 201 || response.status === 200;
  syncPaymentErrors.add(!success);
  
  if (success) {
    successfulPayments.add(1);
    syncPaymentLatencyTrend.add(response.timings.duration);
  } else {
    failedPayments.add(1);
  }

  sleep(1);
}

export function asyncPaymentTest() {
  const orderPayload = getTestPayload();
  const orderResponse = http.post(`${BASE_URL}/orders/sync`, orderPayload, {
    headers: HEADERS,
    timeout: '10s'
  });
  
  if (orderResponse.status !== 200 && orderResponse.status !== 201) {
    console.error(`Failed to create order: ${orderResponse.status}`);
    failedPayments.add(1);
    asyncPaymentErrors.add(true);
    return;
  }
  
  const order = JSON.parse(orderResponse.body);
  
  const startTime = new Date();
  const paymentPayload = JSON.stringify({
    orderId: order.id,
    quantity: Math.floor(Math.random() * 100) + 50,
    currency: 'USD'
  });
  
  const response = http.post(`${BASE_URL}/orders/payment/async`, paymentPayload, {
    headers: HEADERS,
    timeout: '10s'
  });

  handlePaymentResponse(
    response,
    startTime,
    asyncPaymentLatencyTrend,
    asyncPaymentE2ELatency,
    asyncPaymentErrors,
    'async-payment'
  );
  
  sleep(1);
}

export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data),
  };
}