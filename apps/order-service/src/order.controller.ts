import { Controller, Post, Body, Param, Get, Sse } from '@nestjs/common';
import { OrderService } from './order.service';
import { from, Observable } from 'rxjs';
import {
  PAYMENT_PATTERNS,
  PaymentResponseDto,
  ProcessPaymentDto,
} from '@app/common';
import { EventPattern } from '@nestjs/microservices';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post('sync')
  async createOrderSync(@Body() data: { productId: string; quantity: number }) {
    return await this.orderService.createOrderSync(data);
  }

  @Post('async-direct')
  async createOrderAsync(
    @Body() data: { productId: string; quantity: number },
  ) {
    return await this.orderService.createOrderAsync(data);
  }

  @Get('/status/:orderId')
  async getOrderStatus(@Param('orderId') orderId: string) {
    return await this.orderService.getOrderById(orderId);
  }

  @Sse('stream/:orderId')
  streamOrderStatus(
    @Param('orderId') orderId: string,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const interval = setInterval(() => {
        from(this.orderService.getOrderById(orderId)).subscribe({
          next: (order) => {
            if (!order) return;

            subscriber.next(
              new MessageEvent('message', {
                data: {
                  id: order.id,
                  status: order.status,
                  timestamp: new Date().toISOString(),
                },
              }),
            );

            if (order.status === 'confirmed' || order.status === 'failed') {
              clearInterval(interval);
              subscriber.complete();
            }
          },
          error: (error) => subscriber.error(error),
        });
      }, 5);

      return () => clearInterval(interval);
    });
  }

  @Post('/payment/sync')
  async processPaymentSync(@Body() paymentDto: ProcessPaymentDto) {
    return this.orderService.processPaymentSync(paymentDto);
  }

  @Post('/payment/async')
  async processPaymentAsync(@Body() paymentDto: ProcessPaymentDto) {
    try {
      return await this.orderService.processPaymentAsync(paymentDto);
    } catch (error) {
      console.error(`Failed to process payment asynchronously: ${error}`);
    }
  }

  @Get('payment/status/:transactionId')
  async getPaymentStatus(@Param('transactionId') transactionId: string) {
    return this.orderService.getPaymentStatus(transactionId);
  }

  @EventPattern(PAYMENT_PATTERNS.PAYMENT_CALLBACK)
  async handlePaymentStatus(data: {
    orderId: string;
    payload: PaymentResponseDto;
  }) {
    const order = await this.orderService.getOrderById(data.orderId);
    if (data.payload.success) {
      return this.orderService.updateOrderPaymentStatus(order, data.payload);
    }
    return this.orderService.handlePaymentError(order, data.payload.message);
  }

  @Post(':orderId/notify-sync')
  async notifySync(@Param('orderId') orderId: string) {
    const order = await this.orderService.getOrderById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }
    return this.orderService.notifyServicesSync(order);
  }

  @Post(':orderId/notify-async')
  async notifyAsync(@Param('orderId') orderId: string) {
    const order = await this.orderService.getOrderById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }
    return this.orderService.notifyServicesAsync(order);
  }
}
