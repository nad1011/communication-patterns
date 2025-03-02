import { Controller, Post, Body, Logger } from '@nestjs/common';
import { EmailService } from './email.service';
import { EventPattern } from '@nestjs/microservices';

@Controller('emails')
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(private readonly emailService: EmailService) {}

  // Endpoint for synchronous REST calls
  @Post()
  async sendEmail(
    @Body()
    emailData: {
      orderId: string;
      customerId: string;
      subject: string;
      body: string;
    },
  ) {
    this.logger.log(
      `Received sync email request for order: ${emailData.orderId}`,
    );
    // Simulate some processing time for email service (typically slower than notifications)
    await new Promise((resolve) => setTimeout(resolve, 500));
    return this.emailService.sendEmail(emailData);
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

    // Construct email from event data
    return this.emailService.sendEmail({
      orderId: data.orderId,
      customerId: data.customerId,
      subject: `Order Confirmation: #${data.orderId}`,
      body: `Thank you for your order #${data.orderId}. Your order has been confirmed.
      
      Order Details:
      - Product: ${data.productId}
      - Quantity: ${data.quantity}
      - Date: ${new Date(data.timestamp).toLocaleString()}
      
      Thank you for your purchase!`,
    });
  }
}
