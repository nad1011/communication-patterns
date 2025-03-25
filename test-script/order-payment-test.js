import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// Configuration
const BASE_URL = "http://localhost:3000";
const MONITORING_URL = "http://localhost:9090"; // Prometheus URL
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

// Custom metrics
const syncPaymentLatencyTrend = new Trend("sync_payment_latency");
const asyncPaymentLatencyTrend = new Trend("async_payment_latency");
const syncPaymentErrors = new Rate("sync_payment_errors");
const asyncPaymentErrors = new Rate("async_payment_errors");
const successfulPayments = new Counter("successful_payments");
const failedPayments = new Counter("failed_payments");
const asyncPaymentE2ELatency = new Trend("async_payment_e2e_latency");
const asyncPaymentProcessingLatency = new Trend(
  "async_payment_processing_latency"
);

// Additional metrics for extended testing
const orderServiceCPU = new Trend("order_service_cpu");
const orderServiceMemory = new Trend("order_service_memory");
const paymentServiceCPU = new Trend("payment_service_cpu");
const paymentServiceMemory = new Trend("payment_service_memory");
const queueDepth = new Trend("rabbitmq_queue_depth");
const threadPoolUsage = new Trend("thread_pool_usage");
const connectionPoolUsage = new Trend("connection_pool_usage");
const circuitBreakerTrips = new Counter("circuit_breaker_trips");

// Test configuration
export const options = {
  scenarios: {
    // Latency/Performance Testing
    sync_payment_light_load: {
      executor: "constant-vus",
      vus: 10, // Light load: 10 concurrent users
      duration: "1m",
      exec: "syncPaymentTest",
      tags: { test_type: "latency", pattern: "sync", load: "light" },
    },
    async_payment_light_load: {
      executor: "constant-vus",
      vus: 10, // Light load: 10 concurrent users
      duration: "1m",
      exec: "asyncPaymentTest",
      startTime: "1m30s",
      tags: { test_type: "latency", pattern: "async", load: "light" },
    },
    // sync_payment_medium_load: {
    //   executor: "constant-vus",
    //   vus: 50, // Medium load: 50 concurrent users
    //   duration: "1m",
    //   exec: "syncPaymentTest",
    //   startTime: "3m",
    //   tags: { test_type: "latency", pattern: "sync", load: "medium" },
    // },
    // async_payment_medium_load: {
    //   executor: "constant-vus",
    //   vus: 50, // Medium load: 50 concurrent users
    //   duration: "1m",
    //   exec: "asyncPaymentTest",
    //   startTime: "4m30s",
    //   tags: { test_type: "latency", pattern: "async", load: "medium" },
    // },
    // sync_payment_heavy_load: {
    //   executor: "constant-vus",
    //   vus: 200, // Heavy load: 200 concurrent users
    //   duration: "1m",
    //   exec: "syncPaymentTest",
    //   startTime: "6m",
    //   tags: { test_type: "latency", pattern: "sync", load: "heavy" },
    // },
    // async_payment_heavy_load: {
    //   executor: "constant-vus",
    //   vus: 200, // Heavy load: 200 concurrent users
    //   duration: "1m",
    //   exec: "asyncPaymentTest",
    //   startTime: "7m30s",
    //   tags: { test_type: "latency", pattern: "async", load: "heavy" },
    // },

    // // Long Processing Time Testing
    // sync_payment_circuit_breaker: {
    //   executor: "constant-vus",
    //   vus: 50, // Medium load with circuit breaker
    //   duration: "2m",
    //   exec: "syncPaymentLongProcessingTest",
    //   startTime: "9m",
    //   tags: { test_type: "long_processing", pattern: "sync_circuit_breaker" },
    // },
    // async_payment_long_processing: {
    //   executor: "constant-vus",
    //   vus: 50, // Medium load for queue-based testing
    //   duration: "2m",
    //   exec: "asyncPaymentLongProcessingTest",
    //   startTime: "11m30s",
    //   tags: { test_type: "long_processing", pattern: "async_queue" },
    // },
  },
  thresholds: {
    // Basic HTTP thresholds
    http_req_duration: ["p(95)<5000", "p(99)<10000"],
    http_req_failed: ["rate<0.05"],

    // Pattern-specific thresholds
    sync_payment_latency: ["p(95)<3000", "avg<2000"],
    async_payment_latency: ["p(95)<1000", "avg<500"],
    async_payment_e2e_latency: ["p(95)<4000", "avg<3000"],
    successful_payments: ["count>100"],

    // Resource utilization thresholds
    order_service_cpu: ["avg<0.8"],
    payment_service_cpu: ["avg<0.8"],
    rabbitmq_queue_depth: ["max<1000"],
  },
};

// Test data generators
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

// System metrics collection
function getSystemMetrics() {
  // Collect Order Service Metrics
  const orderCpuResponse = http.get(
    `${MONITORING_URL}/api/v1/query?query=process_cpu_seconds_total{service="order-service"}`,
    { headers: { Accept: "application/json" }, timeout: "2s" }
  );

  const orderMemResponse = http.get(
    `${MONITORING_URL}/api/v1/query?query=process_resident_memory_bytes{service="order-service"}`,
    { headers: { Accept: "application/json" }, timeout: "2s" }
  );

  const paymentCpuResponse = http.get(
    `${MONITORING_URL}/api/v1/query?query=process_cpu_seconds_total{service="payment-service"}`,
    { headers: { Accept: "application/json" }, timeout: "2s" }
  );

  const paymentMemResponse = http.get(
    `${MONITORING_URL}/api/v1/query?query=process_resident_memory_bytes{service="payment-service"}`,
    { headers: { Accept: "application/json" }, timeout: "2s" }
  );

  // Collect RabbitMQ Queue Metrics
  const queueDepthResponse = http.get(
    `${MONITORING_URL}/api/v1/query?query=rabbitmq_queue_messages{queue="payment_queue"}`,
    { headers: { Accept: "application/json" }, timeout: "2s" }
  );

  // Parse and record metrics
  try {
    if (orderCpuResponse.status === 200) {
      const data = JSON.parse(orderCpuResponse.body);
      if (data.data?.result?.length > 0) {
        orderServiceCPU.add(parseFloat(data.data.result[0].value[1]));
      }
    }

    if (orderMemResponse.status === 200) {
      const data = JSON.parse(orderMemResponse.body);
      if (data.data?.result?.length > 0) {
        orderServiceMemory.add(
          parseFloat(data.data.result[0].value[1]) / (1024 * 1024)
        ); // Convert to MB
      }
    }

    if (paymentCpuResponse.status === 200) {
      const data = JSON.parse(paymentCpuResponse.body);
      if (data.data?.result?.length > 0) {
        paymentServiceCPU.add(parseFloat(data.data.result[0].value[1]));
      }
    }

    if (paymentMemResponse.status === 200) {
      const data = JSON.parse(paymentMemResponse.body);
      if (data.data?.result?.length > 0) {
        paymentServiceMemory.add(
          parseFloat(data.data.result[0].value[1]) / (1024 * 1024)
        ); // Convert to MB
      }
    }

    if (queueDepthResponse.status === 200) {
      const data = JSON.parse(queueDepthResponse.body);
      if (data.data?.result?.length > 0) {
        queueDepth.add(parseFloat(data.data.result[0].value[1]));
      }
    }
  } catch (e) {
    console.error(`Error parsing metrics: ${e.message}`);
  }
}

// Thread pool and connection pool metrics
function getApplicationMetrics() {
  try {
    const response = http.get(`${BASE_URL}/actuator/metrics`, {
      headers: HEADERS,
    });

    if (response.status === 200) {
      const data = JSON.parse(response.body);

      if (data.threadPool) {
        threadPoolUsage.add(data.threadPool.used / data.threadPool.max);
      }

      if (data.connectionPool) {
        connectionPoolUsage.add(
          data.connectionPool.active / data.connectionPool.max
        );
      }
    }
  } catch (e) {
    console.error(`Error getting application metrics: ${e.message}`);
  }
}

// function waitForPaymentCompletion(orderId, maxTries = 10, interval = 500) {
//   for (let i = 0; i < maxTries; i++) {
//     const statusResponse = http.get(`${BASE_URL}/orders/status/${orderId}`, {
//       headers: HEADERS,
//     });

//     if (statusResponse.status === 200) {
//       const orderData = JSON.parse(statusResponse.body);
//       if (
//         orderData.status === "paid" ||
//         orderData.paymentStatus === "completed"
//       ) {
//         return true;
//       }
//       if (
//         orderData.status === "payment_failed" ||
//         orderData.paymentStatus === "failed"
//       ) {
//         return false;
//       }
//     }

//     sleep(interval / 1000);
//   }

//   return false;
// }

function waitForPaymentCompletion(orderId) {
  const MAX_DURATION = 50000;

  const response = http.get(`${BASE_URL}/orders/stream/${orderId}`, {
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    timeout: MAX_DURATION,
  });

  if (response.status !== 200) {
    console.log(`Error: Received status code ${response.status}`);
    return {
      success: false,
      time: MAX_DURATION,
      error: `Bad status: ${response.status}`,
    };
  }

  if (!response.body) {
    return {
      success: false,
      time: MAX_DURATION,
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

          if (
            eventData.paymentStatus === "completed" ||
            eventData.status === "paid"
          ) {
            console.log("Payment completed successfully");
            return {
              success: true,
              time: MAX_DURATION,
              status: eventData.status,
            };
          }

          if (
            eventData.status === "failed" ||
            eventData.status === "payment_failed"
          ) {
            return {
              success: false,
              time: MAX_DURATION,
              status: eventData.status,
            };
          }
        } catch (parseError) {
          console.log(`Error parsing event data: ${parseError}`);
        }
      }
    }

    return{
      success: false,
      time: MAX_DURATION,
      error: "Expected status not found in events",
      events: eventStrings.length,
    };
  } catch (e) {
    console.log(`Error processing SSE: ${e}`);
    return { success: false, time: MAX_DURATION, error: String(e) };
  }
}

export function syncPaymentTest() {
  // Create order first
  const orderResponse = http.post(
    `${BASE_URL}/orders/sync`,
    createOrderPayload(),
    {
      headers: HEADERS,
    }
  );

  if (orderResponse.status !== 200 && orderResponse.status !== 201) {
    console.error(`Failed to create order: ${orderResponse.status}`);
    failedPayments.add(1);
    syncPaymentErrors.add(true);
    return;
  }

  const order = JSON.parse(orderResponse.body);

  const paymentResponse = http.post(
    `${BASE_URL}/orders/payment/sync`,
    createPaymentPayload(order.id),
    { headers: HEADERS }
  );

  const duration = paymentResponse.timings.duration;
  syncPaymentLatencyTrend.add(duration);

  const success =
    paymentResponse.status === 200 || paymentResponse.status === 201;

  if (success) {
    successfulPayments.add(1);
    syncPaymentErrors.add(false);
  } else {
    failedPayments.add(1);
    syncPaymentErrors.add(true);
    console.error(
      `Sync payment failed: Status ${paymentResponse.status}, Body: ${paymentResponse.body}`
    );
  }

  const paymentCompleted = waitForPaymentCompletion(order.id);

  getSystemMetrics();

  check(paymentResponse, {
    "Sync payment request successful": (r) =>
      r.status === 200 || r.status === 201,
    "Sync payment completed successfully": () => paymentCompleted,
  });

  sleep(1);
}

export function asyncPaymentTest() {
  const orderResponse = http.post(
    `${BASE_URL}/orders/sync`,
    createOrderPayload(),
    {
      headers: HEADERS,
    }
  );

  if (orderResponse.status !== 200 && orderResponse.status !== 201) {
    console.error(`Failed to create order: ${orderResponse.status}`);
    failedPayments.add(1);
    asyncPaymentErrors.add(true);
    return;
  }

  const order = JSON.parse(orderResponse.body);

  const startTime = new Date();
  const paymentResponse = http.post(
    `${BASE_URL}/orders/payment/async`,
    createPaymentPayload(order.id),
    { headers: HEADERS }
  );

  const initialDuration = paymentResponse.timings.duration;
  asyncPaymentLatencyTrend.add(initialDuration);

  const success =
    paymentResponse.status === 200 || paymentResponse.status === 201;

  if (!success) {
    asyncPaymentErrors.add(true);
    failedPayments.add(1);
    console.error(
      `Async payment failed: Status ${paymentResponse.status}, Body: ${paymentResponse.body}`
    );
    return;
  }

  const processingStartTime = new Date();
  const paymentCompleted = waitForPaymentCompletion(order.id);
  const processingDuration = new Date() - processingStartTime;

  const totalDuration = new Date() - startTime;
  asyncPaymentE2ELatency.add(totalDuration);
  asyncPaymentProcessingLatency.add(processingDuration);

  if (paymentCompleted) {
    successfulPayments.add(1);
    asyncPaymentErrors.add(false);
  } else {
    failedPayments.add(1);
    asyncPaymentErrors.add(true);
  }

  // Collect system metrics
  getSystemMetrics();

  // Check queue depth
  try {
    const queueResponse = http.get(
      `${MONITORING_URL}/api/v1/query?query=rabbitmq_queue_messages{queue="payment_queue"}`,
      { headers: { Accept: "application/json" }, timeout: "2s" }
    );

    if (queueResponse.status === 200) {
      const data = JSON.parse(queueResponse.body);
      if (data.data?.result?.length > 0) {
        queueDepth.add(parseFloat(data.data.result[0].value[1]));
      }
    }
  } catch (e) {
    console.error(`Error fetching queue metrics: ${e.message}`);
  }

  // Verify results
  check(paymentResponse, {
    "Async payment request successful": (r) =>
      r.status === 200 || r.status === 201,
    "Async payment completed": () => paymentCompleted,
  });

  sleep(1);
}

export function syncPaymentLongProcessingTest() {
  // Create order first
  const orderResponse = http.post(
    `${BASE_URL}/orders/sync`,
    createOrderPayload(),
    {
      headers: HEADERS,
    }
  );

  if (orderResponse.status !== 200 && orderResponse.status !== 201) {
    console.error(`Failed to create order: ${orderResponse.status}`);
    failedPayments.add(1);
    syncPaymentErrors.add(true);
    return;
  }

  const order = JSON.parse(orderResponse.body);

  // Create payment payload with long processing flag
  const payload = JSON.stringify({
    orderId: order.id,
    amount: Math.floor(Math.random() * 1000) + 100,
    currency: "USD",
    simulateLongProcessing: true,
  });

  const paymentResponse = http.post(
    `${BASE_URL}/orders/payment/sync?processingTime=4000`,
    payload,
    {
      headers: HEADERS,
      timeout: "10s",
    }
  );

  // Record metrics
  const duration = paymentResponse.timings.duration;
  syncPaymentLatencyTrend.add(duration);

  const success =
    paymentResponse.status === 200 || paymentResponse.status === 201;
  const circuitOpen =
    paymentResponse.status === 503 ||
    (paymentResponse.status === 200 &&
      JSON.parse(paymentResponse.body).circuitBreakerStatus === "OPEN");

  if (circuitOpen) {
    circuitBreakerTrips.add(1);
    console.log("Circuit breaker tripped!");
  }

  if (success && !circuitOpen) {
    successfulPayments.add(1);
    syncPaymentErrors.add(false);
  } else if (!circuitOpen) {
    failedPayments.add(1);
    syncPaymentErrors.add(true);
  }

  // Collect system metrics
  getSystemMetrics();
  getApplicationMetrics();

  // Verify results
  check(paymentResponse, {
    "Sync long processing handled": (r) => r.status === 200 || r.status === 503,
    "Circuit breaker properly triggered": () => circuitOpen || success,
  });

  sleep(1);
}

export function asyncPaymentLongProcessingTest() {
  // Create order first
  const orderResponse = http.post(
    `${BASE_URL}/orders/sync`,
    createOrderPayload(),
    {
      headers: HEADERS,
    }
  );

  if (orderResponse.status !== 200 && orderResponse.status !== 201) {
    console.error(`Failed to create order: ${orderResponse.status}`);
    failedPayments.add(1);
    asyncPaymentErrors.add(true);
    return;
  }

  const order = JSON.parse(orderResponse.body);

  // Create payment payload with long processing flag
  const payload = JSON.stringify({
    orderId: order.id,
    amount: Math.floor(Math.random() * 1000) + 100,
    currency: "USD",
    simulateLongProcessing: true,
  });

  // Process payment asynchronously
  const startTime = new Date();
  const paymentResponse = http.post(
    `${BASE_URL}/orders/payment/async?processingTime=4000`,
    payload,
    { headers: HEADERS }
  );

  // Record initial response metrics
  const initialDuration = paymentResponse.timings.duration;
  asyncPaymentLatencyTrend.add(initialDuration);

  const success =
    paymentResponse.status === 200 || paymentResponse.status === 201;

  if (!success) {
    asyncPaymentErrors.add(true);
    failedPayments.add(1);
    console.error(
      `Async long processing payment failed: Status ${paymentResponse.status}`
    );
    return;
  }

  // Wait and check for payment completion with longer timeout
  const processingStartTime = new Date();
  const paymentCompleted = waitForPaymentCompletion(order.id);
  const processingDuration = new Date() - processingStartTime;

  // Record end-to-end latency
  const totalDuration = new Date() - startTime;
  asyncPaymentE2ELatency.add(totalDuration);
  asyncPaymentProcessingLatency.add(processingDuration);

  if (paymentCompleted) {
    successfulPayments.add(1);
    asyncPaymentErrors.add(false);
  } else {
    failedPayments.add(1);
    asyncPaymentErrors.add(true);
  }

  // Collect system metrics
  getSystemMetrics();

  // Check queue depth specifically
  try {
    const queueResponse = http.get(
      `${MONITORING_URL}/api/v1/query?query=rabbitmq_queue_messages{queue="payment_queue"}`,
      { headers: { Accept: "application/json" }, timeout: "2s" }
    );

    if (queueResponse.status === 200) {
      const data = JSON.parse(queueResponse.body);
      if (data.data?.result?.length > 0) {
        queueDepth.add(parseFloat(data.data.result[0].value[1]));
      }
    }
  } catch (e) {
    console.error(`Error fetching queue metrics: ${e.message}`);
  }

  // Verify results
  check(paymentResponse, {
    "Async long processing request accepted": (r) =>
      r.status === 200 || r.status === 201,
    "Async long processing completed eventually": () => paymentCompleted,
  });

  sleep(1);
}

// Generate summary report
export function handleSummary(data) {
  // Create a detailed comparison report
  const report = {
    title: "Order-Payment Testing Results",
    timestamp: new Date().toISOString(),
    testDuration: data.state.testRunDuration,

    latencyComparison: {
      sync: {
        avg: data.metrics.sync_payment_latency.values.avg,
        p90: data.metrics.sync_payment_latency.values["p(90)"],
        p95: data.metrics.sync_payment_latency.values["p(95)"],
        p99: data.metrics.sync_payment_latency.values["p(99)"],
        min: data.metrics.sync_payment_latency.values.min,
        max: data.metrics.sync_payment_latency.values.max,
      },
      async: {
        initialResponseAvg: data.metrics.async_payment_latency.values.avg,
        initialResponseP95: data.metrics.async_payment_latency.values["p(95)"],
        e2eAvg: data.metrics.async_payment_e2e_latency.values.avg,
        e2eP95: data.metrics.async_payment_e2e_latency.values["p(95)"],
        processingAvg: data.metrics.async_payment_processing_latency.values.avg,
      },
    },

    errorRates: {
      sync: data.metrics.sync_payment_errors.values.rate,
      async: data.metrics.async_payment_errors.values.rate,
    },

    successCounts: {
      successful: data.metrics.successful_payments.values.count,
      failed: data.metrics.failed_payments.values.count,
    },

    resourceUtilization: {
      orderServiceCPU: {
        avg: data.metrics.order_service_cpu.values.avg,
        max: data.metrics.order_service_cpu.values.max,
      },
      paymentServiceCPU: {
        avg: data.metrics.payment_service_cpu.values.avg,
        max: data.metrics.payment_service_cpu.values.max,
      },
      orderServiceMemory: {
        avg: data.metrics.order_service_memory.values.avg,
        max: data.metrics.order_service_memory.values.max,
      },
      paymentServiceMemory: {
        avg: data.metrics.payment_service_memory.values.avg,
        max: data.metrics.payment_service_memory.values.max,
      },
      queueDepth: {
        avg: data.metrics.rabbitmq_queue_depth.values.avg,
        max: data.metrics.rabbitmq_queue_depth.values.max,
      },
      threadPoolUsage: data.metrics.thread_pool_usage?.values.avg || "N/A",
      connectionPoolUsage:
        data.metrics.connection_pool_usage?.values.avg || "N/A",
    },

    longProcessingResults: {
      circuitBreakerTrips:
        data.metrics.circuit_breaker_trips?.values.count || 0,
    },

    analysis: {
      syncVsAsyncLatency:
        data.metrics.sync_payment_latency.values.avg <
        data.metrics.async_payment_e2e_latency.values.avg
          ? "Sync is faster"
          : "Async is faster",
      syncVsAsyncErrors:
        data.metrics.sync_payment_errors.values.rate <
        data.metrics.async_payment_errors.values.rate
          ? "Sync is more reliable"
          : "Async is more reliable",
      longProcessingWinner:
        data.metrics.circuit_breaker_trips?.values.count > 0
          ? "Async handles long processing better"
          : "Both patterns handled long processing similarly",
    },
  };

  return {
    "summary.json": JSON.stringify(data),
    "order-payment-testing-report.json": JSON.stringify(report, null, 2),
  };
}
