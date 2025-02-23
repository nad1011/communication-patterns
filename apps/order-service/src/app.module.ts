import { Module } from '@nestjs/common';
import { OrderModule } from './order.module';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@app/common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/order-service/.env',
    }),
    DatabaseModule,
    OrderModule,
  ],
})
export class AppModule {}
