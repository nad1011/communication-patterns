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

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
  ) {}

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
