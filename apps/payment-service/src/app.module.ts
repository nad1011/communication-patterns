import { Module } from '@nestjs/common';
import { PaymentModule } from './payment.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { TerminusModule } from '@nestjs/terminus';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/payment-service/.env',
    }),
    DatabaseModule,
    PaymentModule,
    PrometheusModule.register(),
    TerminusModule,
  ],
})
export class AppModule {}
