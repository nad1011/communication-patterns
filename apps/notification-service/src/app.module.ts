import { Module } from '@nestjs/common';
import { NotificationModule } from './notification.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/notification-service/.env',
    }),
    DatabaseModule,
    NotificationModule,
  ],
})
export class AppModule {}
