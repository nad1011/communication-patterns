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

// Test configuration
export const options = {
  scenarios: {
    // Synchronous Payment Test - Thử nghiệm mô phỏng tải cao
    sync_payment_test: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "20s", target: 5 }, // Bắt đầu với 5 users
        { duration: "20s", target: 10 }, // Tăng lên 10 users
        { duration: "20s", target: 20 }, // Tăng lên 20 users
        { duration: "30s", target: 40 }, // Tăng lên 40 users - tại điểm này sync sẽ bắt đầu gặp vấn đề
        { duration: "30s", target: 60 }, // Tăng lên 60 users - tại điểm này sync sẽ gặp nhiều vấn đề hơn
        { duration: "20s", target: 0 }, // Giảm xuống 0
      ],
      gracefulRampDown: "10s",
      exec: "syncPaymentTest",
    },

    // Asynchronous Payment Test
    async_payment_test: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "20s", target: 5 },
        { duration: "20s", target: 10 },
        { duration: "20s", target: 20 },
        { duration: "30s", target: 40 },
        { duration: "30s", target: 60 },
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "10s",
      exec: "asyncPaymentTest",
      startTime: "3m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<10000", "p(99)<15000"],
    http_req_failed: ["rate<0.1"],

    sync_payment_latency: ["avg<5000", "p(95)<10000"],
    sync_payment_max_latency: ["avg<7000"],
    sync_payment_throughput: ["avg>5"],
    sync_payment_errors: ["rate<0.1"],
    successful_sync_payments: ["count>200"],

    async_payment_initial_latency: ["avg<10", "p(95)<1000"],
    async_payment_e2e_latency: ["avg<3000", "p(95)<6000"],
    async_payment_throughput: ["avg>10"],
    async_payment_errors: ["rate<0.05"],
    successful_async_payments: ["count>200"],
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

// Get system metrics
function getServiceMetrics(serviceName) {
  // Giữ nguyên hàm này
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
            (1024 * 1024), // Convert to MB
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

function waitForPaymentStatus(orderId, expectedStatus = "paid", maxDuration = 7000) {
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

      if (paymentResult.paymentStatus === "completed" && paymentResult.status === "paid") {
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
        "Sync payment processing successful": (data) => data.paymentStatus === "completed" && data.status === "paid",
      });
    } catch (e) {
      console.error(`Failed to parse payment response: ${e.message}, paymentResponse.body: ${JSON.stringify(paymentResponse)}`);
    }
  }

  sleep(Math.random() * 0.5 + 0.2); // 0.2-0.7s think time
}

// Asynchronous Payment Test
export function asyncPaymentTest() {
  const startTime = new Date();

  // Collect service metrics before request
  const preMetrics = getServiceMetrics("payment-service");

  // Create order first
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

  // Process payment asynchronously
  const paymentResponse = http.post(
    `${BASE_URL}/orders/payment/async`,
    createPaymentPayload(order.id),
    { headers: HEADERS }
  );

  // Record initial response latency
  const initialLatency = paymentResponse.timings.duration;
  asyncPaymentLatency.add(initialLatency);

  // Record success/failure of initial request
  const success =
    paymentResponse.status === 200 || paymentResponse.status === 201;

  if (success) {
    // Wait for payment to complete
    const statusResult = waitForPaymentStatus(order.id);

    if (statusResult.success) {
      successfulAsyncPayments.add(1);
      asyncPaymentErrors.add(0);

      // Record E2E latency
      asyncPaymentE2ELatency.add(statusResult.time);

      // Calculate throughput
      const elapsedTimeInSeconds = (new Date() - startTime) / 1000;
      if (elapsedTimeInSeconds > 0) {
        asyncPaymentThroughput.add(1 / elapsedTimeInSeconds);
      }

      // Get post-request metrics
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

  // Verify results
  check(paymentResponse, {
    "Async payment request successful": (r) =>
      r.status === 200 || r.status === 201,
  });

  // Variable sleep to simulate user think time
  sleep(Math.random() * 0.5 + 0.2); // 0.2-0.7s think time
}

// Generate summary report
// export function handleSummary(data) {
//   // Cải thiện định dạng báo cáo để dễ đọc và rõ ràng hơn
//   const report = {
//     title: "Order-Payment Testing Results",
//     timestamp: new Date().toISOString(),
//     testDuration: data.state.testRunDuration,
//     summary: "Comparison between Synchronous and Asynchronous Payment Processing",

//     latencyComparison: {
//       sync: {
//         avg: data.metrics.sync_payment_latency.values.avg.toFixed(2) + " ms",
//         p90: data.metrics.sync_payment_latency.values["p(90)"].toFixed(2) + " ms",
//         p95: data.metrics.sync_payment_latency.values["p(95)"].toFixed(2) + " ms",
//         p99: data.metrics.sync_payment_latency.values["p(99)"].toFixed(2) + " ms",
//         min: data.metrics.sync_payment_latency.values.min.toFixed(2) + " ms",
//         max: data.metrics.sync_payment_latency.values.max.toFixed(2) + " ms",
//       },
//       async: {
//         initialResponseAvg: data.metrics.async_payment_initial_latency.values.avg.toFixed(2) + " ms",
//         initialResponseP95: data.metrics.async_payment_initial_latency.values["p(95)"].toFixed(2) + " ms",
//         e2eAvg: data.metrics.async_payment_e2e_latency.values.avg.toFixed(2) + " ms",
//         e2eP95: data.metrics.async_payment_e2e_latency.values["p(95)"].toFixed(2) + " ms",
//       },
//     },

//     throughputComparison: {
//       sync: data.metrics.sync_payment_throughput.values.avg.toFixed(2) + " req/s",
//       async: data.metrics.async_payment_throughput.values.avg.toFixed(2) + " req/s",
//       comparisonRatio: (data.metrics.async_payment_throughput.values.avg /
//                         data.metrics.sync_payment_throughput.values.avg).toFixed(2) + "x"
//     },

//     errorRates: {
//       sync: (data.metrics.sync_payment_errors.values.rate * 100).toFixed(2) + "%",
//       async: (data.metrics.async_payment_errors.values.rate * 100).toFixed(2) + "%",
//     },

//     successCounts: {
//       syncSuccessful: data.metrics.successful_sync_payments.values.count,
//       syncFailed: data.metrics.failed_sync_payments.values.count,
//       syncSuccessRate: ((data.metrics.successful_sync_payments.values.count /
//                         (data.metrics.successful_sync_payments.values.count +
//                          data.metrics.failed_sync_payments.values.count)) * 100).toFixed(2) + "%",

//       asyncSuccessful: data.metrics.successful_async_payments.values.count,
//       asyncFailed: data.metrics.failed_async_payments.values.count,
//       asyncSuccessRate: ((data.metrics.successful_async_payments.values.count /
//                          (data.metrics.successful_async_payments.values.count +
//                           data.metrics.failed_async_payments.values.count)) * 100).toFixed(2) + "%",
//     },

//     resourceUtilization: {
//       syncPaymentCpu: data.metrics.sync_payment_cpu.values.avg,
//       syncPaymentMemory: data.metrics.sync_payment_memory.values.avg + " MB",
//       asyncPaymentCpu: data.metrics.async_payment_cpu.values.avg,
//       asyncPaymentMemory: data.metrics.async_payment_memory.values.avg + " MB",
//     },

//     analysis: {
//       userExperience: {
//         winner: data.metrics.async_payment_initial_latency.values.avg <
//                 data.metrics.sync_payment_latency.values.avg
//                 ? "Asynchronous payment" : "Synchronous payment",
//         reason: "Based on initial response time to user"
//       },
//       throughputEfficiency: {
//         winner: data.metrics.async_payment_throughput.values.avg >
//                 data.metrics.sync_payment_throughput.values.avg
//                 ? "Asynchronous payment" : "Synchronous payment",
//         reason: "Based on number of payments processed per second"
//       },
//       reliability: {
//         winner: data.metrics.sync_payment_errors.values.rate
//                 data.metrics.async_payment_errors.values.rate
//                 ? "Synchronous payment" : "Asynchronous payment",
//         reason: "Based on error rate during processing"
//       },
//       scalability: {
//         winner: "Asynchronous payment",
//         reason: "Better performance under high load conditions"
//       },
//       overallRecommendation:
//         data.metrics.async_payment_initial_latency.values.avg < 200 &&
//         data.metrics.async_payment_throughput.values.avg >
//         data.metrics.sync_payment_throughput.values.avg
//         ? "Use asynchronous payments for better scalability and user experience"
//         : data.metrics.sync_payment_errors.values.rate < 0.05 &&
//           data.metrics.async_payment_errors.values.rate < 0.05
//           ? data.metrics.sync_payment_latency.values.avg
//             data.metrics.async_payment_e2e_latency.values.avg
//             ? "Use synchronous payments for simple, low-volume payment processing"
//             : "Use asynchronous payments for high-volume payment processing"
//           : "Focus on improving reliability before making architectural decisions",
//     },
//   };

//   return {
//     "summary.json": JSON.stringify(data),
//     "order-payment-testing-report.json": JSON.stringify(report, null, 2),
//     "order-payment-testing-report.html": generateHtmlReport(report),
//   };
// }

// function generateHtmlReport(data) {
//   return `
//   <!DOCTYPE html>
//   <html lang="en">
//   <head>
//     <meta charset="UTF-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//     <title>Payment Processing Comparison</title>
//     <style>
//       body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; }
//       h1, h2, h3 { color: #0066cc; }
//       .container { margin-bottom: 30px; }
//       table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
//       th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
//       th { background-color: #f2f2f2; }
//       .highlight { font-weight: bold; color: #0066cc; }
//       .winner { background-color: #d4edda; }
//       .comparison { display: flex; gap: 20px; }
//       .card { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 20px; }
//       .card h3 { margin-top: 0; }
//       .conclusion { background-color: #f8f9fa; border-left: 5px solid #0066cc; padding: 15px; }
//     </style>
//   </head>
//   <body>
//     <h1>${data.title}</h1>
//     <p><strong>Test conducted:</strong> ${data.timestamp}</p>
//     <p><strong>Test duration:</strong> ${data.testDuration}ms</p>

//     <div class="container">
//       <h2>Latency Comparison</h2>
//       <div class="comparison">
//         <div class="card">
//           <h3>Synchronous Payment</h3>
//           <table>
//             <tr><th>Metric</th><th>Value</th></tr>
//             <tr><td>Average Response Time</td><td>${data.latencyComparison.sync.avg}</td></tr>
//             <tr><td>95th Percentile</td><td>${data.latencyComparison.sync.p95}</td></tr>
//             <tr><td>99th Percentile</td><td>${data.latencyComparison.sync.p99}</td></tr>
//             <tr><td>Min</td><td>${data.latencyComparison.sync.min}</td></tr>
//             <tr><td>Max</td><td>${data.latencyComparison.sync.max}</td></tr>
//           </table>
//         </div>
//         <div class="card">
//           <h3>Asynchronous Payment</h3>
//           <table>
//             <tr><th>Metric</th><th>Value</th></tr>
//             <tr><td>Initial Response Avg</td><td class="highlight">${data.latencyComparison.async.initialResponseAvg}</td></tr>
//             <tr><td>Initial Response 95th</td><td>${data.latencyComparison.async.initialResponseP95}</td></tr>
//             <tr><td>End-to-End Avg</td><td>${data.latencyComparison.async.e2eAvg}</td></tr>
//             <tr><td>End-to-End 95th</td><td>${data.latencyComparison.async.e2eP95}</td></tr>
//           </table>
//         </div>
//       </div>
//     </div>

//     <div class="container">
//       <h2>Throughput Comparison</h2>
//       <table>
//         <tr>
//           <th>Synchronous</th>
//           <th>Asynchronous</th>
//           <th>Comparison Ratio</th>
//         </tr>
//         <tr>
//           <td>${data.throughputComparison.sync}</td>
//           <td>${data.throughputComparison.async}</td>
//           <td class="highlight">${data.throughputComparison.comparisonRatio}</td>
//         </tr>
//       </table>
//     </div>

//     <div class="container">
//       <h2>Success & Error Rates</h2>
//       <table>
//         <tr>
//           <th>Metric</th>
//           <th>Synchronous</th>
//           <th>Asynchronous</th>
//         </tr>
//         <tr>
//           <td>Successful Requests</td>
//           <td>${data.successCounts.syncSuccessful}</td>
//           <td>${data.successCounts.asyncSuccessful}</td>
//         </tr>
//         <tr>
//           <td>Failed Requests</td>
//           <td>${data.successCounts.syncFailed}</td>
//           <td>${data.successCounts.asyncFailed}</td>
//         </tr>
//         <tr>
//           <td>Success Rate</td>
//           <td>${data.successCounts.syncSuccessRate}</td>
//           <td>${data.successCounts.asyncSuccessRate}</td>
//         </tr>
//         <tr>
//           <td>Error Rate</td>
//           <td>${data.errorRates.sync}</td>
//           <td>${data.errorRates.async}</td>
//         </tr>
//       </table>
//     </div>

//     <div class="container">
//       <h2>Analysis</h2>
//       <table>
//         <tr>
//           <th>Category</th>
//           <th>Winner</th>
//           <th>Reason</th>
//         </tr>
//         <tr class="${data.analysis.userExperience.winner === 'Asynchronous payment' ? 'winner' : ''}">
//           <td>User Experience</td>
//           <td>${data.analysis.userExperience.winner}</td>
//           <td>${data.analysis.userExperience.reason}</td>
//         </tr>
//         <tr class="${data.analysis.throughputEfficiency.winner === 'Asynchronous payment' ? 'winner' : ''}">
//           <td>Throughput Efficiency</td>
//           <td>${data.analysis.throughputEfficiency.winner}</td>
//           <td>${data.analysis.throughputEfficiency.reason}</td>
//         </tr>
//         <tr class="${data.analysis.reliability.winner === 'Asynchronous payment' ? 'winner' : ''}">
//           <td>Reliability</td>
//           <td>${data.analysis.reliability.winner}</td>
//           <td>${data.analysis.reliability.reason}</td>
//         </tr>
//         <tr class="winner">
//           <td>Scalability</td>
//           <td>${data.analysis.scalability.winner}</td>
//           <td>${data.analysis.scalability.reason}</td>
//         </tr>
//       </table>
//     </div>

//     <div class="conclusion">
//       <h2>Conclusion and Recommendation</h2>
//       <p>${data.analysis.overallRecommendation}</p>
//     </div>
//   </body>
//   </html>
//   `;
// }
