import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './payment.entity';
import {
  ProcessPaymentDto,
  PaymentResponseDto,
  PAYMENT_PATTERNS,
} from '@app/common';
import { v4 as uuid } from 'uuid';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
    @Inject('KAFKA_CLIENT') private orderClient: ClientProxy,
  ) {}

  async processPayment(
    processPaymentDto: ProcessPaymentDto,
    isSync: boolean,
  ): Promise<PaymentResponseDto> {
    const payment = this.paymentRepository.create({
      orderId: processPaymentDto.orderId,
      quantity: processPaymentDto.quantity,
      currency: processPaymentDto.currency,
      status: 'pending',
    });

    await this.paymentRepository.save(payment);

    try {
      const result = await this.processWithExternalGateway(payment);

      payment.status = result.success ? 'completed' : 'failed';
      payment.transactionId = result.transactionId;
      payment.errorMessage = result.message;

      await this.paymentRepository.save(payment);

      const response = {
        success: result.success,
        transactionId: result.transactionId,
        message: result.message,
        paymentId: payment.id,
        status: payment.status,
      };

      if (!isSync) {
        try {
          await firstValueFrom(
            this.orderClient.emit(PAYMENT_PATTERNS.PAYMENT_CALLBACK, {
              orderId: payment.orderId,
              payload: response,
            }),
          );
        } catch (error) {
          console.error(
            `Failed to send callback for order ${payment.orderId}: ${error}`,
          );
        }
      }

      return response;
    } catch (error) {
      payment.status = 'failed';
      payment.errorMessage = (error as Error).message;
      await this.paymentRepository.save(payment);

      const response = {
        success: false,
        message: 'Payment processing failed',
        paymentId: payment.id,
        status: 'failed',
      };

      if (!isSync) {
        await firstValueFrom(
          this.orderClient.emit(PAYMENT_PATTERNS.PAYMENT_CALLBACK, {
            orderId: payment.orderId,
            payload: response,
          }),
        );
      }

      return response;
    }
  }

  private async processWithExternalGateway(payment: Payment): Promise<{
    success: boolean;
    transactionId?: string;
    message?: string;
  }> {
    const processingTime = Math.floor(Math.random() * 3000); // 1-3 seconds

    await new Promise((resolve) => setTimeout(resolve, processingTime));

    const success = Math.random() < 0.95;

    const transactionId = uuid();

    if (success) {
      return {
        success: true,
        transactionId: transactionId,
        message: `Payment processed successfully ${payment.id}`,
      };
    }

    return {
      success: false,
      message: `Payment declined by gateway ${payment.id}`,
    };
  }

  async getPaymentStatus(paymentId: string): Promise<Payment> {
    return this.paymentRepository.findOneBy({ id: paymentId });
  }

  async getPaymentByOrderId(orderId: string): Promise<Payment> {
    return this.paymentRepository.findOneBy({ orderId });
  }
}
