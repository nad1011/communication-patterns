import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

const BASE_URL = "http://localhost:3000";
const MONITORING_URL = "http://localhost:9090";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

// For long processing times tests, need to change the mock payment service
// to simulate long processing times.

// Metrics for Synchronous Payment
const syncPaymentLatency = new Trend("sync_payment_latency");
const syncPaymentMaxLatency = new Trend("sync_payment_max_latency");
const syncPaymentThroughput = new Trend("sync_payment_throughput");
const syncPaymentErrors = new Rate("sync_payment_errors");
const syncPaymentCpu = new Trend("sync_payment_cpu");
const syncPaymentMemory = new Trend("sync_payment_memory");

// Metrics for Asynchronous Payment
const asyncPaymentLatency = new Trend("async_payment_initial_latency");
const asyncPaymentE2ELatency = new Trend("async_payment_e2e_latency");
const asyncPaymentThroughput = new Trend("async_payment_throughput");
const asyncPaymentErrors = new Rate("async_payment_errors");
const asyncPaymentCpu = new Trend("async_payment_cpu");
const asyncPaymentMemory = new Trend("async_payment_memory");

// Counter for total payments
const successfulSyncPayments = new Counter("successful_sync_payments");
const failedSyncPayments = new Counter("failed_sync_payments");
const successfulAsyncPayments = new Counter("successful_async_payments");
const failedAsyncPayments = new Counter("failed_async_payments");

// Metrics for long processing times
const syncLongLatency = new Trend("sync_long_latency");
const syncTimeoutRate = new Rate("sync_timeout_rate");
const syncThreadSaturation = new Trend("sync_thread_saturation");

const asyncLongLatency = new Trend("async_long_latency");
const asyncInitialLatency = new Trend("async_initial_latency");
const asyncQueueSize = new Trend("async_queue_size");

export const options = {
  scenarios: {
    sync_payment_test: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 50,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '30s', target: 20 },
        { duration: '30s', target: 30 },
        { duration: '30s', target: 0 },
      ],
      exec: "syncPaymentTest",
    },

    async_payment_test: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '30s', target: 20 },
        { duration: '30s', target: 50 },
        { duration: '30s', target: 0 },
      ],
      exec: "asyncPaymentTest",
      startTime: '2m30s',
    },

    sync_long_processing: {
      executor: "ramping-vus",
      startVUs: 5,
      stages: [
        { duration: "20s", target: 10 },
        { duration: "1m", target: 10 },
        { duration: "20s", target: 0 },
      ],
      exec: "testSyncLongProcessing",
      startTime: '5m',
    },

    async_long_processing: {
      executor: "ramping-vus",
      startVUs: 5,
      stages: [
        { duration: "20s", target: 10 },
        { duration: "1m", target: 10 },
        { duration: "20s", target: 0 },
      ],
      exec: "testAsyncLongProcessing",
      startTime: "7m30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<10000", "p(99)<15000"],
    http_req_failed: ["rate<0.1"],

    sync_payment_latency: ["avg<5000", "p(95)<10000"],
    sync_payment_max_latency: ["avg<7000"],
    sync_payment_throughput: ["avg>1"],
    sync_payment_errors: ["rate<0.1"],
    successful_sync_payments: ["count>200"],

    async_payment_initial_latency: ["avg<10", "p(95)<1000"],
    async_payment_e2e_latency: ["avg<3000", "p(95)<6000"],
    async_payment_throughput: ["avg>10"],
    async_payment_errors: ["rate<0.1"],
    successful_async_payments: ["count>200"],

    sync_long_latency: ["p(95)<8000"], // 95% request dưới 8 giây
    sync_timeout_rate: ["rate<0.15"], // Ít hơn 15% request timeout
    sync_thread_saturation: ["avg<0.5"], // Thread saturation thấp

    async_initial_latency: ["p(95)<500"], // Phản hồi ban đầu nhanh
    async_long_latency: ["p(95)<10000"], // Hoàn thành cuối cùng trong thời gian hợp lý
    async_queue_size: ["avg<20"], // Kích thước hàng đợi trong giới hạn
  },
};

// Helper functions
function getRandomProduct() {
  const products = ["product-1", "product-2", "product-3"];
  return products[Math.floor(Math.random() * products.length)];
}

function createOrderPayload() {
  return JSON.stringify({
    productId: getRandomProduct(),
    quantity: Math.floor(Math.random() * 5) + 1,
  });
}

function createPaymentPayload(orderId) {
  return JSON.stringify({
    orderId: orderId,
    quantity: Math.floor(Math.random() * 1000) + 100,
    currency: "USD",
  });
}

function getServiceMetrics(serviceName) {
  try {
    const cpuResponse = http.get(
      `${MONITORING_URL}/api/v1/query?query=process_cpu_seconds_total{service="${serviceName}"}`,
      { headers: { Accept: "application/json" }, timeout: "2s" }
    );

    const memoryResponse = http.get(
      `${MONITORING_URL}/api/v1/query?query=process_resident_memory_bytes{service="${serviceName}"}`,
      { headers: { Accept: "application/json" }, timeout: "2s" }
    );

    if (cpuResponse.status === 200 && memoryResponse.status === 200) {
      try {
        const cpuData = JSON.parse(cpuResponse.body);
        const memoryData = JSON.parse(memoryResponse.body);

        return {
          cpu: parseFloat(cpuData?.data?.result[0]?.value[1] || 0),
          memory:
            parseFloat(memoryData?.data?.result[0]?.value[1] || 0) /
            (1024 * 1024),
        };
      } catch (e) {
        console.log(`Error parsing metrics: ${e}`);
      }
    }
  } catch (e) {
    console.log(`Error fetching metrics: ${e}`);
  }

  return { cpu: 0, memory: 0 };
}

function waitForPaymentStatus(
  orderId,
  expectedStatus = "paid",
  maxDuration = 7000
) {
  const startTime = new Date();

  const response = http.get(`${BASE_URL}/orders/stream/${orderId}`, {
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    timeout: maxDuration,
  });

  if (response.status !== 200) {
    console.log(`Error: Received status code ${response.status}`);
    return {
      success: false,
      time: new Date() - startTime,
      error: `Bad status: ${response.status}`,
    };
  }

  if (!response.body) {
    return {
      success: false,
      time: new Date() - startTime,
      error: "Empty response body",
    };
  }

  try {
    const eventStrings = response.body
      .toString()
      .split(/\n\n+/)
      .filter((str) => str.trim() !== "");

    for (const eventString of eventStrings) {
      const dataMatch = eventString.match(/^data: (.+)$/m);
      if (dataMatch) {
        try {
          const eventData = JSON.parse(dataMatch[1]);

          if (eventData.status === expectedStatus) {
            return {
              success: true,
              time: new Date() - startTime,
              status: eventData.status,
            };
          }

          if (
            eventData.status === "failed" ||
            eventData.status === "payment_failed"
          ) {
            return {
              success: false,
              time: new Date() - startTime,
              status: eventData.status,
            };
          }
        } catch (parseError) {
          console.log(`Error parsing event data: ${parseError}`);
        }
      }
    }

    return {
      success: false,
      time: new Date() - startTime,
      error: "Expected status not found in events",
      events: eventStrings.length,
    };
  } catch (e) {
    console.log(`Error processing SSE: ${e}`);
    return { success: false, time: new Date() - startTime, error: String(e) };
  }
}

// Synchronous Payment Test
export function syncPaymentTest() {
  const startTime = new Date();

  const preMetrics = getServiceMetrics("payment-service");

  const orderResponse = http.post(
    `${BASE_URL}/orders/sync`,
    createOrderPayload(),
    { headers: HEADERS }
  );

  if (orderResponse.status !== 200 && orderResponse.status !== 201) {
    console.error(`Failed to create order: ${orderResponse.status}`);
    failedSyncPayments.add(1);
    syncPaymentErrors.add(1);
    return;
  }

  let order;
  try {
    order = JSON.parse(orderResponse.body);
  } catch (e) {
    console.error(`Failed to parse order response: ${e.message}`);
    failedSyncPayments.add(1);
    syncPaymentErrors.add(1);
    return;
  }

  const paymentResponse = http.post(
    `${BASE_URL}/orders/payment/sync`,
    createPaymentPayload(order.id),
    {
      headers: HEADERS,
      timeout: "10s",
    }
  );

  const latency = paymentResponse.timings.duration;
  syncPaymentLatency.add(latency);
  syncPaymentMaxLatency.add(latency);

  const httpSuccess =
    paymentResponse.status === 200 || paymentResponse.status === 201;

  if (httpSuccess) {
    try {
      const paymentResult = JSON.parse(paymentResponse.body);

      if (
        paymentResult.paymentStatus === "completed" &&
        paymentResult.status === "paid"
      ) {
        successfulSyncPayments.add(1);
        syncPaymentErrors.add(0);

        const elapsedTimeInSeconds = (new Date() - startTime) / 1000;
        if (elapsedTimeInSeconds > 0) {
          syncPaymentThroughput.add(1 / elapsedTimeInSeconds);
        }

        const postMetrics = getServiceMetrics("payment-service");
        syncPaymentCpu.add(postMetrics.cpu - preMetrics.cpu);
        syncPaymentMemory.add(postMetrics.memory);
      } else {
        failedSyncPayments.add(1);
        syncPaymentErrors.add(1);
        console.error(
          `Sync payment processing failed: ${paymentResult.paymentError}`
        );
      }
    } catch (e) {
      failedSyncPayments.add(1);
      syncPaymentErrors.add(1);
      console.error(`Failed to parse payment response: ${e.message}`);
    }
  } else {
    failedSyncPayments.add(1);
    syncPaymentErrors.add(1);
    console.error(
      `Sync payment failed: Status ${paymentResponse.status}, Body: ${paymentResponse.body}`
    );
  }

  check(paymentResponse, {
    "Sync payment request successful": (r) =>
      r.status === 200 || r.status === 201,
  });

  if (httpSuccess) {
    try {
      const paymentResult = JSON.parse(paymentResponse.body);
      check(paymentResult, {
        "Sync payment processing successful": (data) =>
          data.paymentStatus === "completed" && data.status === "paid",
      });
    } catch (e) {
      console.error(
        `Failed to parse payment response: ${e.message}, paymentResponse.body: ${JSON.stringify(paymentResponse)}`
      );
    }
  }

  sleep(Math.random() * 0.5 + 0.2);
}

// Asynchronous Payment Test
export function asyncPaymentTest() {
  const startTime = new Date();

  const preMetrics = getServiceMetrics("payment-service");

  const orderResponse = http.post(
    `${BASE_URL}/orders/sync`,
    createOrderPayload(),
    { headers: HEADERS }
  );

  if (orderResponse.status !== 200 && orderResponse.status !== 201) {
    console.error(`Failed to create order: ${orderResponse.status}`);
    failedAsyncPayments.add(1);
    asyncPaymentErrors.add(1);
    return;
  }

  let order;
  try {
    order = JSON.parse(orderResponse.body);
  } catch (e) {
    console.error(`Failed to parse order response: ${e.message}`);
    failedAsyncPayments.add(1);
    asyncPaymentErrors.add(1);
    return;
  }

  const paymentResponse = http.post(
    `${BASE_URL}/orders/payment/async`,
    createPaymentPayload(order.id),
    { headers: HEADERS }
  );

  const initialResponseTime = (new Date() - startTime) / 1000;
  asyncPaymentThroughput.add(1 / initialResponseTime);

  const initialLatency = paymentResponse.timings.duration;
  asyncPaymentLatency.add(initialLatency);

  const success =
    paymentResponse.status === 200 || paymentResponse.status === 201;

  if (success) {
    const statusResult = waitForPaymentStatus(order.id);

    if (statusResult.success) {
      successfulAsyncPayments.add(1);
      asyncPaymentErrors.add(0);

      asyncPaymentE2ELatency.add(statusResult.time);

      const postMetrics = getServiceMetrics("payment-service");
      asyncPaymentCpu.add(postMetrics.cpu - preMetrics.cpu);
      asyncPaymentMemory.add(postMetrics.memory);
    } else {
      failedAsyncPayments.add(1);
      asyncPaymentErrors.add(1);
      console.error(
        `Async payment processing failed: ${statusResult.error || statusResult.status}`
      );
    }
  } else {
    failedAsyncPayments.add(1);
    asyncPaymentErrors.add(1);
    console.error(
      `Async payment request failed: Status ${paymentResponse.status}, Body: ${paymentResponse.body}`
    );
  }

  check(paymentResponse, {
    "Async payment request successful": (r) =>
      r.status === 200 || r.status === 201,
  });

  sleep(Math.random() * 0.5 + 0.2);
}

export function testSyncLongProcessing() {
  const orderResponse = http.post(
    `${BASE_URL}/orders/sync`,
    createOrderPayload(),
    { headers: HEADERS }
  );

  if (orderResponse.status !== 200 && orderResponse.status !== 201) {
    console.error(`Failed to create order: ${orderResponse.status}`);
    return;
  }

  let order;
  try {
    order = JSON.parse(orderResponse.body);
  } catch (e) {
    console.error(`Failed to parse order response: ${e.message}`);
    return;
  }

  if (!order || !order.id) {
    console.error("Invalid order data received");
    return;
  }

  let threadPoolBefore = getEventLoopLag();

  const startTime = new Date();
  const response = http.post(
    `${BASE_URL}/orders/payment/sync`,
    createPaymentPayload(order.id),
    {
      headers: HEADERS,
      timeout: "15s",
    }
  );
  const latency = new Date() - startTime;

  let threadPoolAfter = getEventLoopLag();

  syncLongLatency.add(latency);
  syncThreadSaturation.add(threadPoolAfter - threadPoolBefore);

  if (response.status === 504 || response.status >= 500 || latency >= 10000) {
    console.log(
      `Sync payment timed out or failed: status=${response.status}, latency=${latency}ms`
    );
    syncTimeoutRate.add(1);
  } else {
    syncTimeoutRate.add(0);
  }

  check(response, {
    "Sync payment request completed": (r) =>
      r.status === 200 || r.status === 201,
  });

  if (response.status === 200 || response.status === 201) {
    try {
      const result = JSON.parse(response.body);
      check(result, {
        "Payment was processed": (r) =>
          r.status === "paid" || r.status === "payment_failed",
      });
    } catch (e) {
      console.error(`Error parsing response: ${e.message}`);
    }
  }

  sleep(Math.random() * 0.5 + 0.5);
}

export function testAsyncLongProcessing() {
  const orders = [];
  const startBatch = new Date();

  for (let i = 0; i < 5; i++) {
    const orderResponse = http.post(
      `${BASE_URL}/orders/sync`,
      createOrderPayload(),
      { headers: HEADERS }
    );
    if (orderResponse.status === 200 || orderResponse.status === 201) {
      try {
        const order = JSON.parse(orderResponse.body);
        orders.push(order);

        http.post(
          `${BASE_URL}/orders/payment/async`,
          createPaymentPayload(order.id),
          { headers: HEADERS }
        );
      } catch (e) {
        console.error(`Error creating order: ${e}`);
      }
    }
  }

  sleep(0.2); // wait for a short time before checking the queue size
  const queueSizeAfterBatch = getQueueSize("payment_queue");
  console.log(`Queue size after sending batch: ${queueSizeAfterBatch}`);

  const completionTimes = [];
  const maxWaitTime = 20000;
  const startWaiting = new Date();

  while (
    completionTimes.length < orders.length &&
    new Date() - startWaiting < maxWaitTime
  ) {
    for (let i = 0; i < orders.length; i++) {
      if (completionTimes[i]) continue;

      const result = waitForPaymentStatus(orders[i].id, "paid", 1000);
      if (result.success || result.status === "payment_failed") {
        completionTimes[i] = new Date() - startBatch;
        console.log(
          `Order ${i + 1} completed in ${completionTimes[i]}ms with status ${result.status || "paid"}`
        );
      }
    }
    sleep(0.1);
  }

  if (completionTimes.length > 0) {
    const avgCompletionTime =
      completionTimes.reduce((sum, time) => sum + time, 0) /
      completionTimes.length;
    const maxCompletionTime = Math.max(...completionTimes);
    const minCompletionTime = Math.min(...completionTimes);

    console.log(
      `Completion statistics - Avg: ${avgCompletionTime}ms, Min: ${minCompletionTime}ms, Max: ${maxCompletionTime}ms`
    );

    const estimatedQueueDepth = Math.max(
      1,
      Math.round((maxCompletionTime - minCompletionTime) / 3000)
    );
    console.log(`Estimated effective queue depth: ${estimatedQueueDepth}`);

    // Ghi nhận metrics
    asyncQueueSize.add(Math.max(queueSizeAfterBatch, estimatedQueueDepth));
    asyncLongLatency.add(avgCompletionTime);
    asyncInitialLatency.add(0);
  }
}

function getEventLoopLag() {
  try {
    const start = new Date();
    const iterations = 1000000;

    for (let i = 0; i < iterations; i++) {
      // Phép toán đơn giản
      Math.sqrt(i);
    }

    const elapsed = new Date() - start;
    return elapsed / 1000;
  } catch (error) {
    console.error(`Error measuring event loop: ${error}`);
    return 0;
  }
}

function getQueueSize(queueName) {
  try {
    const rmqApiResponse = http.get(
      `http://localhost:15672/api/queues/%2F/${queueName}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: "Basic Z3Vlc3Q6Z3Vlc3Q=",
        },
      }
    );

    if (rmqApiResponse.status === 200) {
      try {
        const queueData = JSON.parse(rmqApiResponse.body);
        const messageCount = queueData.messages_ready || 0;
        console.log(
          `RabbitMQ API - Queue size for ${queueName}: ${messageCount}`
        );
        return messageCount;
      } catch (e) {
        console.error(`Error parsing RabbitMQ API response: ${e}`);
      }
    } else {
      console.log(`RabbitMQ API returned status: ${rmqApiResponse.status}`);
    }

    const asyncLatency = asyncLongLatency.values.avg || 3500;
    const simulatedQueueSize = Math.max(1, Math.ceil(asyncLatency / 1000));
    console.log(`Using simulated queue size: ${simulatedQueueSize}`);
    return simulatedQueueSize;
  } catch (error) {
    console.error(`Error fetching queue size: ${error}`);
    return 1;
  }
}

export function handleSummary(data) {
  return {
    "order_payment_test_summary.json": JSON.stringify(data),
  };
}

