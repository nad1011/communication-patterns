import { Module } from '@nestjs/common';
import { ActivityModule } from './activity.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/analytics-service/.env',
    }),
    DatabaseModule,
    ActivityModule,
  ],
})
export class AppModule {}
