import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

const BASE_URL = "http://localhost:3000";
const MONITORING_URL = "http://localhost:9090";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

// Metrics for Multiple Synchronous Calls
const syncTotalBroadcastTime = new Trend("sync_total_broadcast_time");
const syncPerServiceTime = new Trend("sync_per_service_time");
const syncCpuUsage = new Trend("sync_cpu_usage");
const syncMemoryUsage = new Trend("sync_memory_usage");
const syncNetworkIo = new Trend("sync_network_io");
const syncErrors = new Rate("sync_errors");
const syncSuccessRate = new Rate("sync_success_rate");

// Metrics for Pub/Sub Event Bus
const asyncTotalBroadcastTime = new Trend("async_total_broadcast_time");
const asyncPerServiceTime = new Trend("async_per_service_time");
const asyncCpuUsage = new Trend("async_cpu_usage");
const asyncMemoryUsage = new Trend("async_memory_usage");
const asyncNetworkIo = new Trend("async_network_io");
const asyncErrors = new Rate("async_errors");
const asyncSuccessRate = new Rate("async_success_rate");

// Failure resilience metrics
const syncFailureRecoveryTime = new Trend("sync_failure_recovery_time");
const syncErrorPropagation = new Rate("sync_error_propagation");
const syncErrorPropagationRate = new Trend("sync_error_propagation_rate");
const syncRecoveryAttempts = new Trend("sync_recovery_attempts");
const syncErrorAllServicesAffected = new Rate(
  "sync_error_all_services_affected"
);
const syncPartialSuccessRate = new Rate("sync_partial_success_rate");

const asyncFailureRecoveryTime = new Trend("async_failure_recovery_time");
const asyncSubscriberIndependence = new Rate("async_subscriber_independence");

const successfulSyncNotifications = new Counter(
  "successful_sync_notifications"
);
const failedSyncNotifications = new Counter("failed_sync_notifications");
const successfulAsyncNotifications = new Counter(
  "successful_async_notifications"
);
const failedAsyncNotifications = new Counter("failed_async_notifications");

export const options = {
  scenarios: {
    // 3.1 Broadcast Performance for Synchronous Calls
    sync_broadcast_performance: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 20,
      maxDuration: "3m",
      exec: "testSyncBroadcastPerformance",
    },

    // 3.1 Broadcast Performance for Pub/Sub Event Bus
    async_broadcast_performance: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 20,
      maxDuration: "3m",
      exec: "testAsyncBroadcastPerformance",
      startTime: "3m30s",
    },

    // 3.2 Service Failure Impact for Synchronous Calls
    sync_failure_impact: {
      executor: "constant-vus",
      vus: 5,
      duration: "1m",
      exec: "testSyncFailureImpact",
      startTime: "7m",
    },

    // 3.2 Service Failure Impact for Pub/Sub Event Bus
    async_failure_impact: {
      executor: "constant-vus",
      vus: 5,
      duration: "1m",
      exec: "testAsyncFailureImpact",
      startTime: "8m30s",
    },
  },
  thresholds: {
    // Broadcast Performance Thresholds
    sync_total_broadcast_time: ["avg<3000", "p(95)<5000"],
    sync_per_service_time: ["avg<500", "p(95)<1000"],
    sync_errors: ["rate<0.1"],

    async_total_broadcast_time: ["avg<1000", "p(95)<2000"],
    async_errors: ["rate<0.05"],

    // Failure Impact Thresholds
    sync_failure_recovery_time: ["avg<2000", "p(95)<3000"],
    sync_error_propagation: ["rate<0.5"],
    sync_error_propagation_rate: ["avg<0.3"],
    sync_error_all_services_affected: ["rate<0.1"],
    sync_partial_success_rate: ["rate>0.7"],

    async_failure_recovery_time: ["avg<1000", "p(95)<2000"],
    async_subscriber_independence: ["rate>0.9"],

    // Overall success rates
    successful_sync_notifications: ["count>150"],
    successful_async_notifications: ["count>180"],
  },
};

// Helper Functions
function getRandomCustomerId() {
  return `cust-${Math.floor(Math.random() * 1000)}`;
}

function getRandomProductId() {
  const products = ["product-1", "product-2", "product-3"];
  return products[Math.floor(Math.random() * products.length)];
}

async function createTestOrder() {
  const payload = JSON.stringify({
    productId: getRandomProductId(),
    quantity: Math.floor(Math.random() * 3) + 1,
    customerId: getRandomCustomerId(),
  });

  const response = http.post(`${BASE_URL}/orders/sync`, payload, {
    headers: HEADERS,
  });

  if (response.status !== 200 && response.status !== 201) {
    console.error(`Failed to create order: ${response.status}`);
    return null;
  }

  try {
    return JSON.parse(response.body);
  } catch (e) {
    console.error(`Failed to parse order response: ${e.message}`);
    return null;
  }
}

function getSystemMetrics(serviceName) {
  try {
    const cpuResponse = http.get(
      `${MONITORING_URL}/api/v1/query?query=process_cpu_seconds_total{service="${serviceName}"}`,
      { headers: { Accept: "application/json" }, timeout: "2s" }
    );

    const memoryResponse = http.get(
      `${MONITORING_URL}/api/v1/query?query=process_resident_memory_bytes{service="${serviceName}"}`,
      { headers: { Accept: "application/json" }, timeout: "2s" }
    );

    const networkResponse = http.get(
      `${MONITORING_URL}/api/v1/query?query=node_network_transmit_bytes_total{service="${serviceName}"}`,
      { headers: { Accept: "application/json" }, timeout: "2s" }
    );

    if (cpuResponse.status === 200 && memoryResponse.status === 200) {
      try {
        const cpuData = JSON.parse(cpuResponse.body);
        const memoryData = JSON.parse(memoryResponse.body);
        const networkData = JSON.parse(networkResponse.body);

        return {
          cpu: cpuData?.data?.result[0]?.value[1] || 0,
          memory: memoryData?.data?.result[0]?.value[1] || 0,
          network: networkData?.data?.result[0]?.value[1] || 0,
        };
      } catch (e) {
        console.log(`Error parsing metrics: ${e}`);
      }
    }
  } catch (e) {
    console.log(`Error fetching metrics: ${e}`);
  }

  return { cpu: 0, memory: 0, network: 0 };
}

// 3.1 Broadcast Performance - Synchronous Calls
export async function testSyncBroadcastPerformance() {
  const order = await createTestOrder();

  if (!order) {
    syncErrors.add(1);
    failedSyncNotifications.add(1);
    return;
  }

  const preMetrics = {
    order: getSystemMetrics("order-service"),
    notification: getSystemMetrics("notification-service"),
    email: getSystemMetrics("email-service"),
    analytics: getSystemMetrics("analytics-service"),
  };

  const startTime = new Date();

  const syncResponse = http.post(
    `${BASE_URL}/orders/${order.id}/notify-sync`,
    "",
    { headers: HEADERS }
  );

  const totalTime = new Date() - startTime;
  syncTotalBroadcastTime.add(totalTime);

  let success = false;
  let perServiceTimes = {};

  if (syncResponse.status === 200 || syncResponse.status === 201) {
    try {
      const responseData = JSON.parse(syncResponse.body);

      if (
        responseData.services?.notification &&
        responseData.services.notification.time
      ) {
        syncPerServiceTime.add(responseData.services.notification.time);
        perServiceTimes.notification = responseData.services.notification.time;
      }

      if (responseData.services?.email && responseData.services.email.time) {
        syncPerServiceTime.add(responseData.services.email.time);
        perServiceTimes.email = responseData.services.email.time;
      }

      if (
        responseData.services?.analytics &&
        responseData.services.analytics.time
      ) {
        syncPerServiceTime.add(responseData.services.analytics.time);
        perServiceTimes.analytics = responseData.services.analytics.time;
      }

      success =
        responseData.services?.notification?.success !== false &&
        responseData.services?.email?.success !== false &&
        responseData.services?.analytics?.success !== false;
    } catch (e) {
      console.error(`Failed to parse response: ${e.message}`);
      success = false;
    }
  } else {
    console.error(`Sync notification failed: ${syncResponse.status}`);
    success = false;
  }

  const postMetrics = {
    order: getSystemMetrics("order-service"),
    notification: getSystemMetrics("notification-service"),
    email: getSystemMetrics("email-service"),
    analytics: getSystemMetrics("analytics-service"),
  };

  syncCpuUsage.add(
    postMetrics.order.cpu -
      preMetrics.order.cpu +
      (postMetrics.notification.cpu - preMetrics.notification.cpu) +
      (postMetrics.email.cpu - preMetrics.email.cpu) +
      (postMetrics.analytics.cpu - preMetrics.analytics.cpu)
  );

  syncMemoryUsage.add(
    (postMetrics.order.memory +
      postMetrics.notification.memory +
      postMetrics.email.memory +
      postMetrics.analytics.memory) /
      4
  );

  syncNetworkIo.add(
    postMetrics.order.network -
      preMetrics.order.network +
      (postMetrics.notification.network - preMetrics.notification.network) +
      (postMetrics.email.network - preMetrics.email.network) +
      (postMetrics.analytics.network - preMetrics.analytics.network)
  );

  // Record success rate
  syncSuccessRate.add(success);
  syncErrors.add(!success);

  if (success) {
    successfulSyncNotifications.add(1);
  } else {
    failedSyncNotifications.add(1);
  }

  check(
    {
      responseCode: syncResponse.status,
      totalTime: totalTime,
      perServiceTimes: perServiceTimes,
    },
    {
      "Sync notification request was successful": (r) =>
        r.responseCode === 200 || r.responseCode === 201,
      "Total broadcast time is acceptable": (r) => r.totalTime < 3000,
      "Per-service notification time is acceptable": (r) =>
        !r.perServiceTimes.notification ||
        r.perServiceTimes.notification < 1000,
      "Per-service email time is acceptable": (r) =>
        !r.perServiceTimes.email || r.perServiceTimes.email < 1000,
      "Per-service analytics time is acceptable": (r) =>
        !r.perServiceTimes.analytics || r.perServiceTimes.analytics < 1000,
    }
  );

  sleep(Math.random() * 0.3 + 0.2);
}

// 3.1 Broadcast Performance - Pub/Sub Event Bus
export async function testAsyncBroadcastPerformance() {
  const order = await createTestOrder();

  if (!order) {
    asyncErrors.add(1);
    failedAsyncNotifications.add(1);
    return;
  }

  const preMetrics = {
    order: getSystemMetrics("order-service"),
    notification: getSystemMetrics("notification-service"),
    email: getSystemMetrics("email-service"),
    analytics: getSystemMetrics("analytics-service"),
  };

  const startTime = new Date();

  const asyncResponse = http.post(
    `${BASE_URL}/orders/${order.id}/notify-async`,
    "",
    { headers: HEADERS }
  );

  const totalTime = new Date() - startTime;
  asyncTotalBroadcastTime.add(totalTime);

  let success = false;

  if (asyncResponse.status === 200 || asyncResponse.status === 201) {
    try {
      const responseData = JSON.parse(asyncResponse.body);

      success = responseData.success === true;

      if (responseData.time) {
        asyncPerServiceTime.add(responseData.time);
      }
    } catch (e) {
      console.error(`Failed to parse response: ${e.message}`);
      success = false;
    }
  } else {
    console.error(`Async notification failed: ${asyncResponse.status}`);
    success = false;
  }

  sleep(0.5);

  const postMetrics = {
    order: getSystemMetrics("order-service"),
    notification: getSystemMetrics("notification-service"),
    email: getSystemMetrics("email-service"),
    analytics: getSystemMetrics("analytics-service"),
  };

  asyncCpuUsage.add(
    postMetrics.order.cpu -
      preMetrics.order.cpu +
      (postMetrics.notification.cpu - preMetrics.notification.cpu) +
      (postMetrics.email.cpu - preMetrics.email.cpu) +
      (postMetrics.analytics.cpu - preMetrics.analytics.cpu)
  );

  asyncMemoryUsage.add(
    (postMetrics.order.memory +
      postMetrics.notification.memory +
      postMetrics.email.memory +
      postMetrics.analytics.memory) /
      4
  );

  asyncNetworkIo.add(
    postMetrics.order.network -
      preMetrics.order.network +
      (postMetrics.notification.network - preMetrics.notification.network) +
      (postMetrics.email.network - preMetrics.email.network) +
      (postMetrics.analytics.network - preMetrics.analytics.network)
  );

  asyncSuccessRate.add(success);
  asyncErrors.add(!success);

  if (success) {
    successfulAsyncNotifications.add(1);
  } else {
    failedAsyncNotifications.add(1);
  }

  check(
    {
      responseCode: asyncResponse.status,
      totalTime: totalTime,
    },
    {
      "Async notification request was successful": (r) =>
        r.responseCode === 200 || r.responseCode === 201,
      "Total broadcast time is acceptable": (r) => r.totalTime < 1000,
    }
  );

  sleep(Math.random() * 0.3 + 0.2);
}

export async function testSyncFailureImpact() {
  const order = await createTestOrder();

  if (!order) {
    syncErrors.add(1);
    return;
  }

  const services = ["notification", "email", "analytics"];
  const disabledService = services[Math.floor(Math.random() * services.length)];

  const startTime = new Date();

  const syncResponse = http.post(
    `${BASE_URL}/orders/${order.id}/notify-sync`,
    JSON.stringify({
      disabledService: disabledService,
    }),
    { headers: HEADERS }
  );

  const totalTime = new Date() - startTime;
  syncFailureRecoveryTime.add(totalTime);

  let errorPropagationValue = 0;
  let allServicesAffected = false;
  let partialSuccess = false;
  let recoveryTime = 0;
  let recoveryAttempts = 0;

  if (syncResponse.status === 200 || syncResponse.status === 201) {
    try {
      const responseData = JSON.parse(syncResponse.body);

      if (responseData.recoveryMetrics?.totalRecoveryTime) {
        recoveryTime = responseData.recoveryMetrics.totalRecoveryTime;
        syncFailureRecoveryTime.add(recoveryTime);
      }

      if (responseData.recoveryMetrics?.recoveryAttempts) {
        recoveryAttempts = responseData.recoveryMetrics.recoveryAttempts;
        syncRecoveryAttempts.add(recoveryAttempts);
      }

      if (responseData.errorMetrics) {
        errorPropagationValue = responseData.errorMetrics.errorPropagation;
        syncErrorPropagationRate.add(errorPropagationValue);

        allServicesAffected =
          responseData.errorMetrics.failedServices ===
          responseData.errorMetrics.totalServices;
        syncErrorAllServicesAffected.add(allServicesAffected);

        syncErrorPropagation.add(errorPropagationValue > 0);
      }

      partialSuccess =
        responseData.partialSuccess || responseData.completedServices > 0;
      syncPartialSuccessRate.add(partialSuccess);
    } catch (e) {
      console.error(`Failed to parse response: ${e.message}`);
      syncErrorPropagation.add(true);
      syncErrorAllServicesAffected.add(true);
      syncPartialSuccessRate.add(false);
    }
  } else {
    console.error(`Sync notification failed: ${syncResponse.status}`);
    syncErrorPropagation.add(true);
    syncErrorAllServicesAffected.add(true);
    syncPartialSuccessRate.add(false);
  }

  check(
    {
      responseReceived: syncResponse.status < 500,
      errorPropagation: errorPropagationValue,
      allServicesAffected: allServicesAffected,
      partialSuccess: partialSuccess,
      recoveryTime: recoveryTime,
    },
    {
      "Response was received despite failures": (r) => r.responseReceived,
      "Error did not propagate to all services": (r) => !r.allServicesAffected,
      "At least one service succeeded despite failures": (r) =>
        r.partialSuccess,
      "System recovered within acceptable time": (r) => r.recoveryTime < 5000,
    }
  );

  sleep(Math.random() * 0.5 + 0.5);
}

// 3.2 Service Failure Impact - Pub/Sub Event Bus
export async function testAsyncFailureImpact() {
  // Disabling a service before run this test

  const order = await createTestOrder();

  if (!order) {
    asyncErrors.add(1);
    return;
  }

  const startTime = new Date();

  const asyncResponse = http.post(
    `${BASE_URL}/orders/${order.id}/notify-async`,
    "",
    { headers: HEADERS }
  );

  const recoveryTime = new Date() - startTime;
  asyncFailureRecoveryTime.add(recoveryTime);

  let publishSuccessful = false;

  if (asyncResponse.status === 200 || asyncResponse.status === 201) {
    try {
      const responseData = JSON.parse(asyncResponse.body);
      publishSuccessful = responseData.success === true;
    } catch (e) {
      console.error(`Failed to parse response: ${e.message}`);
      publishSuccessful = false;
    }
  } else {
    console.error(`Async notification failed: ${asyncResponse.status}`);
    publishSuccessful = false;
  }

  asyncSubscriberIndependence.add(publishSuccessful ? 1 : 0);

  check(
    {
      responseCode: asyncResponse.status,
      publishSuccessful: publishSuccessful,
      recoveryTime: recoveryTime,
    },
    {
      "Pub/Sub event was published successfully": (r) => r.publishSuccessful,
      "Response code indicates success": (r) =>
        r.responseCode === 200 || r.responseCode === 201,
      "Publishing completed within acceptable time": (r) =>
        r.recoveryTime < 1000,
    }
  );

  sleep(Math.random() * 0.5 + 0.5); 
}

export function handleSummary(data) {
  return {
    "order_notification_test_summary.json": JSON.stringify(data),
  };
}