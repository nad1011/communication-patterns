import { Controller, Post, Body, Param, Get, Sse } from '@nestjs/common';
import { OrderService } from './order.service';
import { from, Observable } from 'rxjs';

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
    return await this.orderService.getOrdersStatus(orderId);
  }

  @Sse('stream/:orderId')
  streamOrderStatus(
    @Param('orderId') orderId: string,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const interval = setInterval(() => {
        from(this.orderService.getOrdersStatus(orderId)).subscribe({
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
}
