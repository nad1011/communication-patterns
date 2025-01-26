import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MessagePattern, EventPattern } from '@nestjs/microservices';
import { InventoryService } from './inventory.service';
import { CheckInventoryDto } from './dto/check-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // Sync One-to-One
  @Get('check/:productId')
  async checkInventorySync(@Param('productId') productId: string) {
    return this.inventoryService.checkInventory({ productId, quantity: 1 });
  }

  @Post('update')
  async updateInventorySync(@Body() updateInventoryDto: UpdateInventoryDto) {
    return this.inventoryService.updateInventory(updateInventoryDto);
  }

  // Async One-to-One (RabbitMQ)
  @MessagePattern('check_inventory')
  async handleCheckInventory(data: CheckInventoryDto) {
    return this.inventoryService.checkInventory(data);
  }

  @MessagePattern('update_inventory')
  async handleUpdateInventory(data: UpdateInventoryDto) {
    return this.inventoryService.updateInventory(data);
  }

  // Async One-to-Many (Kafka)
  @EventPattern('order_created')
  async handleOrderCreated(data: {
    orderId: string;
    productId: string;
    quantity: number;
  }) {
    const updateDto: UpdateInventoryDto = {
      orderId: data.orderId,
      productId: data.productId,
      quantity: data.quantity,
    };

    return this.inventoryService.updateInventory(updateDto);
  }
}
