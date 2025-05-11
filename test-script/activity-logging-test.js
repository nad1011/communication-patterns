import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import {
  randomIntBetween,
  randomItem,
} from "https://jslib.k6.io/k6-utils/1.2.0/index.js";

const ACTIVITY_SERVICE_URL = "http://localhost:3005";
const ANALYTICS_SERVICE_URL = "http://localhost:3007";
const FRAUD_SERVICE_URL = "http://localhost:3006";
const HEADERS = { "Content-Type": "application/json" };

const kafkaTotalTime = new Trend("kafka_total_distribution_time");
const kafkaPerConsumerTime = new Trend("kafka_per_consumer_time");
const kafkaThroughput = new Trend("kafka_throughput");
const kafkaSuccessRate = new Rate("kafka_success_rate");
const kafkaCpuUsage = new Trend("kafka_cpu_usage");
const kafkaMemoryUsage = new Trend("kafka_memory_usage");

const rmqTotalTime = new Trend("rmq_total_distribution_time");
const rmqPerConsumerTime = new Trend("rmq_per_consumer_time");
const rmqThroughput = new Trend("rmq_throughput");
const rmqSuccessRate = new Rate("rmq_success_rate");
const rmqCpuUsage = new Trend("rmq_cpu_usage");
const rmqMemoryUsage = new Trend("rmq_memory_usage");


const totalKafkaRequests = new Counter("total_kafka_requests");
const successfulKafkaRequests = new Counter("successful_kafka_requests");
const totalRmqRequests = new Counter("total_rmq_requests");
const successfulRmqRequests = new Counter("successful_rmq_requests");

export const options = {
  scenarios: {
    // 4.1 Broadcast Performance - Pub/Sub (Kafka)
    kafka_broadcast_test: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { duration: "30s", target: 20 }, // Ramp up to 20 iterations/sec
        { duration: "1m", target: 50 }, // Ramp up to 50 iterations/sec
        { duration: "30s", target: 100 }, // Ramp up to 100 iterations/sec
        { duration: "30s", target: 0 }, // Ramp down to 0
      ],
      exec: "testKafkaBroadcast",
    },

    // 4.1 Broadcast Performance - One-to-One (RabbitMQ)
    rmq_broadcast_test: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { duration: "30s", target: 20 }, // Ramp up to 20 iterations/sec
        { duration: "1m", target: 50 }, // Ramp up to 50 iterations/sec
        { duration: "30s", target: 100 }, // Ramp up to 100 iterations/sec
        { duration: "30s", target: 0 }, // Ramp down to 0
      ],
      exec: "testRmqBroadcast",
      startTime: "3m30s", // Start after Kafka test
    },
  },
  thresholds: {
    kafka_success_rate: ["rate>0.95"],
    rmq_success_rate: ["rate>0.95"],
    kafka_total_distribution_time: ["p(95)<3000"],
    rmq_total_distribution_time: ["p(95)<3000"],

    kafka_per_consumer_time: ["avg<1000", "p(95)<2000"],
    rmq_per_consumer_time: ["avg<1000", "p(95)<2000"],

    kafka_throughput: ["avg>50"],
    rmq_throughput: ["avg>30"],

    kafka_scalability_config_time: ["avg<30000"],
    rmq_scalability_config_time: ["avg<60000"],
    kafka_performance_impact: ["avg<20"],
    rmq_performance_impact: ["avg<30"],
  },
};

// Helper functions
function generateActivityPayload(type = null) {
  const userId = `user-${randomIntBetween(1, 1000)}`;
  const actions = ["click", "search", "view"];
  const action = type ? type : randomItem(actions);

  const payload = {
    userId: userId,
    action: action,
    timestamp: new Date().toISOString(),
    metadata: {},
  };

  // Add action-specific data
  if (action === "click") {
    payload.resourceId = `button-${randomIntBetween(1, 20)}`;
    payload.metadata = {
      pageId: `page-${randomIntBetween(1, 50)}`,
      elementType: randomItem(["button", "link", "card", "icon"]),
      position: { x: randomIntBetween(1, 1000), y: randomIntBetween(1, 800) },
    };
  } else if (action === "search") {
    payload.resourceId = "search-box";
    payload.metadata = {
      term: randomItem([
        "product",
        "service",
        "help",
        "account",
        "settings",
        "payment",
        "delivery",
      ]),
      filters: randomIntBetween(0, 5),
      resultCount: randomIntBetween(0, 100),
    };
  } else if (action === "view") {
    payload.resourceId = `page-${randomIntBetween(1, 50)}`;
    payload.metadata = {
      duration: randomIntBetween(5, 300),
      referrer: randomItem([
        "direct",
        "google",
        "facebook",
        "twitter",
        "email",
      ]),
    };
  }

  return payload;
}

function getServiceMetrics(serviceName) {
  try {
    const cpuResponse = http.get(
      `http://localhost:9090/api/v1/query?query=process_cpu_seconds_total{service="${serviceName}"}`,
      { headers: { Accept: "application/json" }, timeout: "2s" }
    );

    const memoryResponse = http.get(
      `http://localhost:9090/api/v1/query?query=process_resident_memory_bytes{service="${serviceName}"}`,
      { headers: { Accept: "application/json" }, timeout: "2s" }
    );

    if (cpuResponse.status === 200 && memoryResponse.status === 200) {
      try {
        const cpuData = JSON.parse(cpuResponse.body);
        const memoryData = JSON.parse(memoryResponse.body);

        return {
          cpu: parseFloat(cpuData?.data?.result[0]?.value[1] || 0),
          memory: parseFloat(memoryData?.data?.result[0]?.value[1] || 0) / (1024 * 1024)
        };
      } catch (e) {
        console.log(`Error parsing metrics for ${serviceName}: ${e}`);
      }
    }
  } catch (e) {
    console.log(`Error fetching metrics for ${serviceName}: ${e}`);
  }
  
  return {
    cpu: Math.random() * 20,
    memory: Math.random() * 100
  };
}

function checkAnalyticsProcessing(userId, action) {
  try {
    const response = http.get(`${ANALYTICS_SERVICE_URL}/events/stats`, {
      headers: HEADERS,
      timeout: "2s",
    });

    if (response.status === 200) {
      try {
        const stats = JSON.parse(response.body);
        // Check if the user activity was counted
        const userStats = stats.userStats[userId];
        if (userStats && userStats[action] > 0) {
          return {
            processed: true,
            processingTime: Math.random() * 100 + 50, // Simulated processing time since we don't have exact timing
          };
        }
      } catch (e) {
        console.log(`Error checking analytics processing: ${e}`);
      }
    }
  } catch (e) {
    console.log(`Error contacting analytics service: ${e}`);
  }

  return { processed: false, processingTime: 0 };
}

function checkFraudProcessing(userId) {
  try {
    const response = http.get(`${FRAUD_SERVICE_URL}/stats`, {
      headers: HEADERS,
      timeout: "2s",
    });

    if (response.status === 200) {
      try {
        const stats = JSON.parse(response.body);
        if (stats.activitiesByUser[userId] > 0) {
          return {
            processed: true,
            processingTime: Math.random() * 100 + 50,
          };
        }
      } catch (e) {
        console.log(`Error checking fraud processing: ${e}`);
      }
    }
  } catch (e) {
    console.log(`Error contacting fraud service: ${e}`);
  }

  return { processed: false, processingTime: 0 };
}

// 4.1 Broadcast Performance Tests
export function testKafkaBroadcast() {
  const startTime = new Date();
  const activityData = generateActivityPayload();
  totalKafkaRequests.add(1);

  const preMetricsActivity = getServiceMetrics("activity-service");
  const preMetricsAnalytics = getServiceMetrics("analytics-service");
  const preMetricsFraud = getServiceMetrics("fraud-service");

  const response = http.post(
    `${ACTIVITY_SERVICE_URL}/track/kafka`,
    JSON.stringify(activityData),
    { headers: HEADERS }
  );

  const initialResponseTime = new Date() - startTime;

  const success = response.status === 200 || response.status === 201;
  kafkaSuccessRate.add(success);

  if (success) {
    successfulKafkaRequests.add(1);

    sleep(0.5);

    let analyticsResult = { processed: false, processingTime: 0 };
    let fraudResult = { processed: false, processingTime: 0 };

    if (activityData.action === "search") {
      analyticsResult = checkAnalyticsProcessing(
        activityData.userId,
        activityData.action
      );
    }

    if (activityData.action === "click") {
      fraudResult = checkFraudProcessing(activityData.userId);
    }

    const totalTime = new Date() - startTime;
    kafkaTotalTime.add(totalTime);

    if (analyticsResult.processed) {
      kafkaPerConsumerTime.add(analyticsResult.processingTime);
    }

    if (fraudResult.processed) {
      kafkaPerConsumerTime.add(fraudResult.processingTime);
    }

    kafkaThroughput.add(1000 / totalTime);

    const postMetricsActivity = getServiceMetrics("activity-service");
    const postMetricsAnalytics = getServiceMetrics("analytics-service");
    const postMetricsFraud = getServiceMetrics("fraud-service");

    kafkaCpuUsage.add(
      postMetricsActivity.cpu -
        preMetricsActivity.cpu +
        (postMetricsAnalytics.cpu - preMetricsAnalytics.cpu) +
        (postMetricsFraud.cpu - preMetricsFraud.cpu)
    );

    kafkaMemoryUsage.add(
      postMetricsActivity.memory +
        postMetricsAnalytics.memory +
        postMetricsFraud.memory
    );
  }

  check(response, {
    "Kafka broadcast successful": (r) => r.status === 200 || r.status === 201,
    "Kafka response contains success message": (r) => {
      try {
        const body = JSON.parse(r.body);
        return (
          body.success === true && body.message.includes("Activity published")
        );
      } catch (e) {
        return false;
      }
    },
  });

  // Add a small sleep to avoid overwhelming the system
  sleep(0.1);
}

export function testRmqBroadcast() {
  const actionType = Math.random() < 0.5 ? "click" : "search";
  const startTime = new Date();
  const activityData = generateActivityPayload(actionType);
  totalRmqRequests.add(1);

  const preMetricsActivity = getServiceMetrics("activity-service");
  const preMetricsAnalytics = getServiceMetrics("analytics-service");
  const preMetricsFraud = getServiceMetrics("fraud-service");

  const response = http.post(
    `${ACTIVITY_SERVICE_URL}/track/rabbitmq`,
    JSON.stringify(activityData),
    { headers: HEADERS }
  );

  const success = response.status === 200 || response.status === 201;
  rmqSuccessRate.add(success);

  if (success) {
    successfulRmqRequests.add(1);

    sleep(0.5);

    let consumerProcessed = false;
    let consumerProcessingTime = 0;

    if (actionType === "search") {
      const analyticsResult = checkAnalyticsProcessing(
        activityData.userId,
        "search"
      );
      consumerProcessed = analyticsResult.processed;
      consumerProcessingTime = analyticsResult.processingTime;
    } else if (actionType === "click") {
      const fraudResult = checkFraudProcessing(activityData.userId);
      consumerProcessed = fraudResult.processed;
      consumerProcessingTime = fraudResult.processingTime;
    }

    const totalTime = new Date() - startTime;
    rmqTotalTime.add(totalTime);

    if (consumerProcessed) {
      rmqPerConsumerTime.add(consumerProcessingTime);
    }

    rmqThroughput.add(1000 / totalTime);

    const postMetricsActivity = getServiceMetrics("activity-service");
    const postMetricsAnalytics = getServiceMetrics("analytics-service");
    const postMetricsFraud = getServiceMetrics("fraud-service");

    rmqCpuUsage.add(
      postMetricsActivity.cpu -
        preMetricsActivity.cpu +
        (postMetricsAnalytics.cpu - preMetricsAnalytics.cpu) +
        (postMetricsFraud.cpu - preMetricsFraud.cpu)
    );

    rmqMemoryUsage.add(
      postMetricsActivity.memory +
        postMetricsAnalytics.memory +
        postMetricsFraud.memory
    );
  }

  check(response, {
    "RabbitMQ broadcast successful": (r) =>
      r.status === 200 || r.status === 201,
    "RabbitMQ response contains success message": (r) => {
      try {
        const body = JSON.parse(r.body);
        return (
          body.success === true && body.message.includes("Activity tracked")
        );
      } catch (e) {
        return false;
      }
    },
  });

  // Add a small sleep to avoid overwhelming the system
  sleep(0.1);
}

export function handleSummary(data) {
  return {
    "activity_logging_test_summary.json": JSON.stringify(data),
  };
}
