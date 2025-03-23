import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// Metrics for Synchronous (REST) communication
const syncLatencyTrend = new Trend("sync_latency");
const syncP95Latency = new Trend("sync_p95_latency");
const syncThroughput = new Trend("sync_throughput");
const syncErrors = new Rate("sync_errors");
const syncConsistencyRate = new Rate("sync_consistency_rate");
const syncCpuUsage = new Trend("sync_cpu_usage");
const syncMemoryUsage = new Trend("sync_memory_usage");

// Metrics for Asynchronous (Message Queue) communication
const asyncLatencyTrend = new Trend("async_latency");
const asyncE2ELatency = new Trend("async_e2e_latency");
const asyncThroughput = new Trend("async_throughput");
const asyncErrors = new Rate("async_errors");
const asyncConsistencyRate = new Rate("async_consistency_rate");
const asyncConsistencyTime = new Trend("async_consistency_time");
const asyncDataLag = new Trend("async_data_lag");
const asyncCpuUsage = new Trend("async_cpu_usage");
const asyncMemoryUsage = new Trend("async_memory_usage");

// Counter metrics for better tracking
const successfulSyncRequests = new Counter("successful_sync_requests");
const failedSyncRequests = new Counter("failed_sync_requests");
const successfulAsyncRequests = new Counter("successful_async_requests");
const failedAsyncRequests = new Counter("failed_async_requests");

export const options = {
  scenarios: {
    // 1.1 Latency/Performance Testing - Synchronous
    sync_performance_test: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "30s", target: 25 }, // Ramp up to 25 users
        { duration: "1m", target: 50 }, // Ramp up to 50 users
        { duration: "30s", target: 75 }, // Ramp up to 75 users
        { duration: "1m", target: 100 }, // Ramp up to 100 users
        { duration: "30s", target: 0 }, // Ramp down to 0
      ],
      gracefulRampDown: "10s",
      exec: "syncPerformanceTest",
    },

    // 1.1 Latency/Performance Testing - Asynchronous
    async_performance_test: {
      executor: "ramping-arrival-rate", // Changed to arrival rate for better control
      startRate: 5, // 5 iterations per second
      timeUnit: "1s",
      preAllocatedVUs: 10,
      maxVUs: 50,
      stages: [
        { duration: "30s", target: 10 }, // Ramp up to 10 iterations/s
        { duration: "1m", target: 20 }, // Ramp up to 20 iterations/s
        { duration: "30s", target: 30 }, // Ramp up to 30 iterations/s
        { duration: "30s", target: 0 }, // Ramp down to 0
      ],
      exec: "asyncPerformanceTest",
      startTime: "4m",
    },

    // 1.2 Data Consistency Testing - Synchronous
    sync_consistency_test: {
      executor: "per-vu-iterations", // Changed to per-VU iterations
      vus: 10,
      iterations: 100, // Total 1000 iterations (matches test plan)
      maxDuration: "2m",
      exec: "syncConsistencyTest",
      startTime: "8m",
    },

    // 1.2 Data Consistency Testing - Asynchronous
    async_consistency_test: {
      executor: "per-vu-iterations", // Changed to per-VU iterations
      vus: 10,
      iterations: 100, // Total 1000 iterations (matches test plan)
      maxDuration: "3m", // Longer duration for async consistency
      exec: "asyncConsistencyTest",
      startTime: "10m30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000", "p(99)<3000"],
    http_req_failed: ["rate<0.05"],

    // Sync performance metrics
    sync_latency: ["p(95)<1000", "avg<500"],
    sync_p95_latency: ["avg<1000"],
    sync_throughput: ["avg>20"],
    sync_errors: ["rate<0.05"],

    // Async performance metrics
    async_e2e_latency: ["p(95)<2000", "avg<1000"],
    async_throughput: ["avg>10"],
    async_errors: ["rate<0.1"],

    // Consistency metrics
    sync_consistency_rate: ["rate>0.95"],
    async_consistency_rate: ["rate>0.9"],
    async_consistency_time: ["p(95)<5000"],
    async_data_lag: ["avg<2000"],

    // Success metrics
    successful_sync_requests: ["count>800"],
    successful_async_requests: ["count>800"],
  },
};

const BASE_URL = "http://localhost:3000";
const INVENTORY_URL = "http://localhost:3001";
const MONITORING_URL = "http://localhost:9090"; // Prometheus endpoint
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

const PRODUCTS = [
  "product-1",
  "product-2",
  "product-3",
];

// Helper to get test payload with more variance
function getTestPayload() {
  return JSON.stringify({
    productId: PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)],
    quantity: Math.floor(Math.random() * 3) + 1,
  });
}

// Helper to check inventory status directly
function checkInventoryDirect(productId) {
  return http.get(`${INVENTORY_URL}/inventory/check/${productId}`, {
    headers: HEADERS,
  });
}

// Helper to get system metrics from Prometheus (if available)
function getSystemMetrics(serviceName) {
  try {
    const cpuResponse = http.get(
      `${MONITORING_URL}/api/v1/query?query=process_cpu_seconds_total{service="${serviceName}"}`,
      {
        headers: { Accept: "application/json" },
        timeout: "2s",
      }
    );

    const memoryResponse = http.get(
      `${MONITORING_URL}/api/v1/query?query=process_resident_memory_bytes{service="${serviceName}"}`,
      {
        headers: { Accept: "application/json" },
        timeout: "2s",
      }
    );

    if (cpuResponse.status === 200 && memoryResponse.status === 200) {
      try {
        const cpuData = JSON.parse(cpuResponse.body);
        const memoryData = JSON.parse(memoryResponse.body);

        return {
          cpu: cpuData?.data?.result[0]?.value[1] || 0,
          memory: memoryData?.data?.result[0]?.value[1] || 0,
        };
      } catch (e) {
        console.log(`Error parsing metrics: ${e}`);
        return { cpu: 0, memory: 0 };
      }
    }
  } catch (e) {
    console.log(`Error fetching metrics: ${e}`);
  }

  return { cpu: 0, memory: 0 };
}

// Helper to wait for order status update with better error handling
function waitForOrderStatus(
  orderId,
  expectedStatus,
  maxRetries = 20,
  interval = 250
) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = http.get(`${BASE_URL}/orders/status/${orderId}`, {
        headers: HEADERS,
        timeout: "2s",
      });

      if (response.status === 200) {
        const orderData = JSON.parse(response.body);
        if (orderData.status === expectedStatus) {
          return { success: true, time: i * interval };
        }
      }
    } catch (e) {
      console.log(`Error checking order status: ${e}`);
    }

    sleep(interval / 1000);
  }

  return { success: false, time: maxRetries * interval };
}

// Helper to verify inventory consistency after order with retries
function verifyInventoryConsistency(
  productId,
  orderedQuantity,
  initialLevel,
  maxRetries = 1
) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = checkInventoryDirect(productId);

      if (response.status === 200) {
        const inventoryData = JSON.parse(response.body);
        const expectedLevel = initialLevel - orderedQuantity;
        if (inventoryData.quantity === expectedLevel) {
          return { consistent: true, attempts: i + 1 };
        }
      }

      if (i < maxRetries - 1) {
        sleep(0.5); // Short sleep between retries
      }
    } catch (e) {
      console.log(`Error verifying inventory: ${e}`);
    }
  }

  return { consistent: false, attempts: maxRetries };
}

// 1.1 Latency/Performance Testing - Synchronous approach
export function syncPerformanceTest() {
  const startTime = new Date();
  const payload = getTestPayload();

  // Record system metrics before request
  const preMetrics = getSystemMetrics("order-service");

  // Send order with synchronous inventory update
  const response = http.post(`${BASE_URL}/orders/sync`, payload, {
    headers: HEADERS,
    timeout: "10s",
    tags: { name: "sync_order_create" },
  });

  // Calculate and add latency
  const latency = response.timings.duration;
  syncLatencyTrend.add(latency);

  // Record p95 latency for this batch (simulation)
  if (latency > syncP95Latency.value) {
    syncP95Latency.add(latency);
  }

  // Record success/failure
  const success = response.status === 200 || response.status === 201;
  syncErrors.add(!success);

  if (success) {
    successfulSyncRequests.add(1);

    // Calculate and record throughput (requests per second)
    const elapsedTimeInSeconds = (new Date() - startTime) / 1000;
    if (elapsedTimeInSeconds > 0) {
      syncThroughput.add(1 / elapsedTimeInSeconds);
    }

    // Record system metrics after request
    const postMetrics = getSystemMetrics("order-service");
    syncCpuUsage.add(postMetrics.cpu - preMetrics.cpu);
    syncMemoryUsage.add(postMetrics.memory);

    // Verify the response
    check(response, {
      "sync response status is 2xx": (r) => r.status >= 200 && r.status < 300,
      "sync response has order data": (r) => {
        try {
          const data = JSON.parse(r.body);
          return data.id !== undefined;
        } catch (e) {
          return false;
        }
      },
    });
  } else {
    failedSyncRequests.add(1);
    console.error(
      `Sync operation failed: Status ${response.status}, Body: ${response.body}`
    );
  }

  // Add a small sleep to avoid overwhelming the system
  sleep(Math.random() * 0.3 + 0.1); // Variable sleep 0.1-0.4s
}

// 1.1 Latency/Performance Testing - Asynchronous approach
export function asyncPerformanceTest() {
  // Record the start timestamp for E2E latency
  const startTime = new Date();
  const payload = getTestPayload();

  // Record system metrics before request
  const preMetrics = getSystemMetrics("order-service");

  try {
    // Make the async order request
    const response = http.post(`${BASE_URL}/orders/async-direct`, payload, {
      headers: HEADERS,
      timeout: "15s",
      tags: { name: "async_order_create" },
    });

    // Record initial response latency
    asyncLatencyTrend.add(response.timings.duration);

    const success = response.status === 200 || response.status === 201;

    if (success) {
      try {
        const orderData = JSON.parse(response.body);

        // Wait for order status to complete
        const statusResult = waitForOrderStatus(
          orderData.id,
          "confirmed",
          30,
          200
        );

        // Record that we got a response
        if (statusResult.success) {
          successfulAsyncRequests.add(1);

          // Record system metrics after processing
          const postMetrics = getSystemMetrics("order-service");
          asyncCpuUsage.add(postMetrics.cpu - preMetrics.cpu);
          asyncMemoryUsage.add(postMetrics.memory);

          // Record E2E latency
          const totalTime = new Date() - startTime;
          asyncE2ELatency.add(totalTime);

          // Calculate and record throughput
          const elapsedTimeInSeconds = totalTime / 1000;
          if (elapsedTimeInSeconds > 0) {
            asyncThroughput.add(1 / elapsedTimeInSeconds);
          }
        } else {
          asyncErrors.add(true);
          failedAsyncRequests.add(1);
        }
      } catch (e) {
        console.log(`Error parsing async response: ${e}`);
        asyncErrors.add(true);
        failedAsyncRequests.add(1);
      }
    } else {
      asyncErrors.add(true);
      failedAsyncRequests.add(1);
      console.error(
        `Async operation failed: Status ${response.status}, Body: ${response.body}`
      );
    }
  } catch (e) {
    console.error(`Exception in async test: ${e}`);
    asyncErrors.add(true);
    failedAsyncRequests.add(1);
  }

  sleep(1);
}

// 1.2 Data Consistency Testing - Synchronous approach
export function syncConsistencyTest() {
  // Get product and check initial inventory level
  const productId = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
  const initialCheck = checkInventoryDirect(productId);

  if (initialCheck.status !== 200) {
    syncConsistencyRate.add(false);
    return;
  }

  try {
    const initialInventory = JSON.parse(initialCheck.body);
    const orderQuantity = Math.floor(Math.random() * 3) + 1;

    // Skip if not enough inventory
    if (initialInventory.quantity < orderQuantity) {
      // Not a failure, just skip this test iteration
      return;
    }

    // Create an order that will update inventory synchronously
    const payload = JSON.stringify({
      productId: productId,
      quantity: orderQuantity,
    });

    const startTime = new Date();
    const orderResponse = http.post(`${BASE_URL}/orders/sync`, payload, {
      headers: HEADERS,
      tags: { name: "sync_consistency_order" },
    });

    if (orderResponse.status !== 200 && orderResponse.status !== 201) {
      syncConsistencyRate.add(false);
      failedSyncRequests.add(1);
      return;
    }

    // Immediately check inventory to verify it was updated
    const verifyResult = verifyInventoryConsistency(
      productId,
      orderQuantity,
      initialInventory.quantity,
      3 // Allow up to 3 attempts
    );

    // Record consistency rate
    syncConsistencyRate.add(verifyResult.consistent);

    // Record end-to-end processing time
    const totalTime = new Date() - startTime;
    syncLatencyTrend.add(totalTime);

    if (verifyResult.consistent) {
      successfulSyncRequests.add(1);
    } else {
      failedSyncRequests.add(1);
    }
  } catch (e) {
    console.error(`Exception in sync consistency test: ${e}`);
    syncConsistencyRate.add(false);
    failedSyncRequests.add(1);
  }

  sleep(0.2);
}

// 1.2 Data Consistency Testing - Asynchronous approach
export function asyncConsistencyTest() {
  try {
    // Get product and check initial inventory level
    const productId = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
    const initialCheck = checkInventoryDirect(productId);

    if (initialCheck.status !== 200) {
      asyncConsistencyRate.add(false);
      return;
    }

    const initialInventory = JSON.parse(initialCheck.body);
    const orderQuantity = Math.floor(Math.random() * 3) + 1;

    // Skip if not enough inventory
    if (initialInventory.quantity < orderQuantity) {
      // Not a failure, just skip this test iteration
      return;
    }

    // Create an order that will update inventory asynchronously
    const payload = JSON.stringify({
      productId: productId,
      quantity: orderQuantity,
    });

    const startTime = new Date();
    const orderResponse = http.post(
      `${BASE_URL}/orders/async-direct`,
      payload,
      {
        headers: HEADERS,
        timeout: "15s",
        tags: { name: "async_consistency_order" },
      }
    );

    if (orderResponse.status !== 200 && orderResponse.status !== 201) {
      asyncConsistencyRate.add(false);
      failedAsyncRequests.add(1);
      return;
    }

    const MAX_CONSISTENCY_CHECKS = 20;
    const CONSISTENCY_CHECK_INTERVAL = 250; // ms
    let consistencyTime = 0;
    let isConsistent = false;

    // Record initial order creation success
    successfulAsyncRequests.add(0.5);

    for (let i = 0; i < MAX_CONSISTENCY_CHECKS; i++) {
      sleep(CONSISTENCY_CHECK_INTERVAL / 1000);
      consistencyTime += CONSISTENCY_CHECK_INTERVAL;

      const verifyResult = verifyInventoryConsistency(
        productId,
        orderQuantity,
        initialInventory.quantity,
        1
      );

      isConsistent = verifyResult.consistent;
      if (isConsistent) {
        break;
      }
    }

    // Record data consistency rate
    asyncConsistencyRate.add(isConsistent);

    if (isConsistent) {
      successfulAsyncRequests.add(0.5);

      // Record metrics for consistency time and data lag
      asyncConsistencyTime.add(consistencyTime);
      asyncDataLag.add(consistencyTime);
    } else {
      failedAsyncRequests.add(0.5);
    }

    // Record end-to-end processing time
    const totalTime = new Date() - startTime;
    asyncE2ELatency.add(totalTime);
  } catch (e) {
    console.error(`Exception in async consistency test: ${e}`);
    asyncConsistencyRate.add(false);
    failedAsyncRequests.add(1);
  }

  // Add a variable sleep
  sleep(Math.random() * 0.5 + 0.5);
}

export function handleSummary(data) {
  return {
    "order_inventory_test_summary.json": JSON.stringify(data),
    "order_inventory_test_summary.html": generateHtmlReport(data),
  };
}
