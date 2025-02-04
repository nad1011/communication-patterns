import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryModule } from './inventory.module';
import { Inventory } from './inventory.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: '10112003',
      database: 'inventory_service',
      entities: [Inventory],
      synchronize: true,
      autoLoadEntities: true,
    }),
    InventoryModule,
  ],
})
export class AppModule {}
