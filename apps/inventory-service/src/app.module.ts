import { Module } from '@nestjs/common';
import { InventoryModule } from './inventory.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { TerminusModule } from '@nestjs/terminus';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/inventory-service/.env',
    }),
    DatabaseModule,
    InventoryModule,
    TerminusModule,
    PrometheusModule.register(),
  ],
})
export class AppModule {}
