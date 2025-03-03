import { Module } from '@nestjs/common';
import { FraudModule } from './fraud.module';
import { DatabaseModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: './apps/fraud-service/.env',
    }),
    DatabaseModule,
    FraudModule,
  ],
})
export class AppModule {}
