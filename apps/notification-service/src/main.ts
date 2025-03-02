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
        clientId: 'notification-service',
        brokers: ['localhost:9092'],
      },
      consumer: {
        groupId: 'notification-group',
      },
    },
  });

  // Start all microservices
  await app.startAllMicroservices();

  // Start HTTP service
  await app.listen(3004);
}
bootstrap().catch((error) => {
  console.error('Error during bootstrap:', error);
});
