import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/analytics-service/.env',
    }),
    DatabaseModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
