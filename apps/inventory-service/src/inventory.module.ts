import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { Inventory } from './inventory.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Inventory])],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
