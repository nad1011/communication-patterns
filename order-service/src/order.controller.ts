import { Controller, Post, Body } from '@nestjs/common';
import { OrderService } from './order.service';

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

  @Post('async-event')
  async createOrderEvent(
    @Body() data: { productId: string; quantity: number },
  ) {
    return await this.orderService.createOrderEvent(data);
  }
}
