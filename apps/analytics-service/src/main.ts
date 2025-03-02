import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Configure Kafka microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'analytics-service',
        brokers: ['localhost:9092'],
      },
      consumer: {
        groupId: 'analytics-group',
      },
    },
  });

  // Start all microservices
  await app.startAllMicroservices();

  // Start HTTP service
  await app.listen(3002);
}
bootstrap().catch((error) => {
  console.error('Error during bootstrap:', error);
});
