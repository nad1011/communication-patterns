import { Module } from '@nestjs/common';
import { InventoryModule } from './inventory.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/inventory-service/.env',
    }),
    DatabaseModule,
    InventoryModule,
  ],
})
export class AppModule {}
