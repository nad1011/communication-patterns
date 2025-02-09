import { Controller, Get, Post, Body, Param, Logger } from '@nestjs/common';
import { MessagePattern, EventPattern } from '@nestjs/microservices';
import { InventoryService } from './inventory.service';
import { CheckInventoryDto } from './dto/check-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { CreateInventoryDto } from './dto/create-inventory.dto';

@Controller('inventory')
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  async createInventory(@Body() createInventoryDto: CreateInventoryDto) {
    return this.inventoryService.createInventory(createInventoryDto);
  }

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
  @MessagePattern('check_update_inventory')
  async handleCheckInventory(data: CheckInventoryDto) {
    const result = await this.inventoryService.checkInventory(data);
    if (result.isAvailable) {
      this.logger.log(`Inventory check successful for ${data.productId}`);
      return this.inventoryService.updateInventory(data);
    }
    return { isAvailable: false };
  }

  // Async One-to-Many (Kafka)
  @EventPattern('order_created')
  async handleOrderCreated(data: {
    orderId: string;
    productId: string;
    quantity: number;
  }) {
    const checkResult = await this.inventoryService.checkInventory({
      productId: data.productId,
      quantity: data.quantity,
    });

    if (!checkResult.isAvailable) {
      return {
        status: 'failed',
        orderId: data.orderId,
        error: 'Insufficient inventory',
      };
    }

    return this.inventoryService.updateInventory({
      productId: data.productId,
      quantity: data.quantity,
    });
  }
}
