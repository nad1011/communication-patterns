import { Controller, Post, Body, Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { EventPattern } from '@nestjs/microservices';

@Controller('notifications')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly notificationService: NotificationService) {}

  // Endpoint for synchronous REST calls
  @Post()
  async createNotification(
    @Body()
    notificationData: {
      orderId: string;
      customerId: string;
      message: string;
      type: string;
    },
  ) {
    this.logger.log(
      `Received sync notification request for order: ${notificationData.orderId}`,
    );
    // Simulate some processing time
    await new Promise((resolve) => setTimeout(resolve, 200));
    return this.notificationService.sendNotification(notificationData);
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

    // Construct notification from event data
    return this.notificationService.sendNotification({
      orderId: data.orderId,
      customerId: data.customerId,
      message: `Your order #${data.orderId} has been confirmed`,
      type: 'ORDER_CONFIRMATION',
    });
  }
}
