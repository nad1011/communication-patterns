import { Controller, Post, Body, Logger } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { EventPattern } from '@nestjs/microservices';

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
}
