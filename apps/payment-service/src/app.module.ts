import { Module } from '@nestjs/common';
import { PaymentModule } from './payment.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/payment-service/.env',
    }),
    DatabaseModule,
    PaymentModule,
  ],
})
export class AppModule {}
