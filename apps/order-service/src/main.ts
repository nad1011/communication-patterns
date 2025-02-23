import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // RabbitMQ Configuration
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: ['amqp://localhost:5672'],
      queue: 'inventory_queue',
      queueOptions: {
        durable: true,
      },
    },
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: ['amqp://localhost:5672'],
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
        brokers: ['localhost:9092'],
      },
      consumer: {
        groupId: 'order-group',
      },
    },
  });

  await app.startAllMicroservices();
  await app.listen(3000);
}
bootstrap().catch((error) => {
  console.error('Error during bootstrap:', error);
});
