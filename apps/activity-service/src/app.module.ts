import { Module } from '@nestjs/common';
import { ActivityModule } from './activity.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { TerminusModule } from '@nestjs/terminus';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/analytics-service/.env',
    }),
    DatabaseModule,
    ActivityModule,
    PrometheusModule.register(),
    TerminusModule,
  ],
})
export class AppModule {}
