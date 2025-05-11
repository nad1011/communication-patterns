import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'FRAUD_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [
            process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
          ],
          queue: 'fraud_queue',
          queueOptions: {
            durable: true,
          },
        },
      },
      {
        name: 'ANALYTICS_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [
            process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
          ],
          queue: 'analytics_queue',
          queueOptions: {
            durable: true,
          },
        },
      },
      // Kafka client for one-to-many communication
      {
        name: 'KAFKA_SERVICE',
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: 'activity-service',
            brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
          },
          producer: {
            allowAutoTopicCreation: true,
          },
        },
      },
    ]),
  ],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
