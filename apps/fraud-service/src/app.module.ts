import { Module } from '@nestjs/common';
import { FraudModule } from './fraud.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { TerminusModule } from '@nestjs/terminus';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/fraud-service/.env',
    }),
    DatabaseModule,
    FraudModule,
    PrometheusModule.register(),
    TerminusModule,
  ],
})
export class AppModule {}
