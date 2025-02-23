import { Controller, Get, Post, Body, Param, Logger } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import {
  CheckInventoryDto,
  UpdateInventoryDto,
  CreateInventoryDto,
} from '@app/common';
import { InventoryService } from './inventory.service';

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
    const checkResult = await this.inventoryService.checkInventory(data);
    if (checkResult.isAvailable) {
      this.logger.log(`Inventory check successful for ${data.productId}`);
      return this.inventoryService.updateInventory(data);
    }
    return checkResult;
  }
}
