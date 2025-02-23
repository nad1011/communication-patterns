import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { Payment } from './payment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment]),
    ClientsModule.registerAsync([
      {
        name: 'PAYMENT_SERVICE',
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: ['amqp://localhost:5672'],
            queue: 'payment_queue',
            queueOptions: {
              durable: true,
            },
          },
        }),
      },
      {
        name: 'ORDER_SERVICE',
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: ['amqp://localhost:5672'],
            queue: 'order_queue',
            queueOptions: {
              durable: true,
            },
          },
        }),
      },
    ]),
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
})
export class PaymentModule {}
