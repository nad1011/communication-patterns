import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // RabbitMQ Configuration
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [`${process.env.RABBITMQ_HOST}:${process.env.RABBITMQ_PORT}`],
      queue: 'inventory_queue',
      queueOptions: {
        durable: true,
      },
    },
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [`${process.env.RABBITMQ_HOST}:${process.env.RABBITMQ_PORT}`],
      queue: 'order_queue', // Queue để nhận callback từ payment service
      queueOptions: {
        durable: true,
      },
    },
  });

  // Kafka Configuration
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'order-service',
        brokers: [process.env.KAFKA_BROKERS],
      },
      consumer: {
        groupId: 'order-consumer',
        allowAutoTopicCreation: true,
      },
      producer: {
        allowAutoTopicCreation: true,
      },
    },
  });

  await app.startAllMicroservices();
  await app.listen(3000);
}
bootstrap().catch((error) => {
  console.error('Error during bootstrap:', error);
});
