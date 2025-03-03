import { Controller, Post, Body, Logger, Get } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';

@Controller('events')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  // Endpoint for synchronous REST calls
  @Post()
  async trackEvent(
    @Body()
    eventData: {
      orderId: string;
      customerId: string;
      event: string;
      metadata: any;
    },
  ) {
    this.logger.log(
      `Received sync event tracking request: ${eventData.event} for order: ${eventData.orderId}`,
    );
    // Simulate some processing time
    await new Promise((resolve) => setTimeout(resolve, 300));
    return this.analyticsService.trackEvent(eventData);
  }

  // Handler for asynchronous Kafka events
  @EventPattern('order_confirmed')
  async handleOrderConfirmed(data: {
    orderId: string;
    customerId: string;
    status: string;
    productId: string;
    quantity: number;
    timestamp: string;
  }) {
    this.logger.log(`Received async event for order: ${data.orderId}`);

    // Track the event from kafka data
    return this.analyticsService.trackEvent({
      orderId: data.orderId,
      customerId: data.customerId,
      event: 'ORDER_CONFIRMED',
      metadata: {
        productId: data.productId,
        quantity: data.quantity,
        orderDate: data.timestamp,
      },
    });
  }

  @Get('stats')
  getStats() {
    return this.analyticsService.getStats();
  }

  // RabbitMQ Message Pattern Handler (One-to-One)
  @MessagePattern('user_search')
  handleUserSearch(@Payload() data: any) {
    this.logger.log(`[RabbitMQ] Received user search: ${JSON.stringify(data)}`);
    return this.analyticsService.processUserSearch(data);
  }

  // Kafka Event Pattern Handler (One-to-Many)
  @EventPattern('user_activity')
  handleUserActivity(@Payload() data: any) {
    this.logger.log(`[Kafka] Received user activity: ${JSON.stringify(data)}`);

    // Log all activities for analytics but process search specifically
    this.analyticsService.logActivity(data.value);

    // Process search events
    if (data.value.action === 'search') {
      return this.analyticsService.processUserSearch(data.value);
    }

    return null;
  }
}
