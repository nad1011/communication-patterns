import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from './inventory.entity';
import { CheckInventoryDto } from './dto/check-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { CreateInventoryDto } from './dto/create-inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
  ) {}

  async createInventory(createInventoryDto: CreateInventoryDto) {
    const inventory = this.inventoryRepository.create({
      productId: createInventoryDto.productId,
      quantity: createInventoryDto.quantity,
      isAvailable: createInventoryDto.quantity > 0,
    });

    return this.inventoryRepository.save(inventory);
  }

  async checkInventory(checkInventoryDto: CheckInventoryDto) {
    const inventory = await this.inventoryRepository.findOne({
      where: { productId: checkInventoryDto.productId },
    });

    if (!inventory) {
      throw new NotFoundException(
        `Product ${checkInventoryDto.productId} not found`,
      );
    }

    if (inventory.quantity < checkInventoryDto.quantity) {
      throw new BadRequestException('Insufficient inventory');
    }

    return inventory;
  }

  async updateInventory(updateInventoryDto: UpdateInventoryDto) {
    const inventory = await this.inventoryRepository.findOne({
      where: { productId: updateInventoryDto.productId },
    });

    if (!inventory) {
      throw new NotFoundException(
        `Product ${updateInventoryDto.productId} not found`,
      );
    }

    if (inventory.quantity < updateInventoryDto.quantity) {
      throw new BadRequestException('Insufficient inventory');
    }

    inventory.quantity -= updateInventoryDto.quantity;
    inventory.isAvailable = inventory.quantity > 0;

    return this.inventoryRepository.save(inventory);
  }
}
