import { Module } from '@nestjs/common';
import { EmailModule } from './email.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/email-service/.env',
    }),
    DatabaseModule,
    EmailModule,
  ],
})
export class AppModule {}
