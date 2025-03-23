import { Module } from '@nestjs/common';
import { OrderModule } from './order.module';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@app/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { TerminusModule } from '@nestjs/terminus';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/order-service/.env',
    }),
    DatabaseModule,
    OrderModule,
    TerminusModule,
    PrometheusModule.register(),
  ],
})
export class AppModule {}
