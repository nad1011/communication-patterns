import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Configure RabbitMQ microservice
  app.connectMicroservice({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'],
      queue: 'payment_queue',
      queueOptions: {
        durable: true,
      },
    },
  });

  // Configure Kafka microservice
  app.connectMicroservice({
    transport: Transport.KAFKA,
    options: {
      client: {
        brokers: ['localhost:9092'],
        clientId: 'payment-service',
      },
      consumer: {
        groupId: 'payment-consumer',
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
