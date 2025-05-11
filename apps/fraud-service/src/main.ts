import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'],
      queue: 'fraud_queue',
      queueOptions: {
        durable: true,
      },
    },
  });

  // Start all microservices
  await app.startAllMicroservices();

  // Start HTTP service
  await app.listen(3006);
}
bootstrap().catch((error) => {
  console.error('Error during bootstrap:', error);
});
