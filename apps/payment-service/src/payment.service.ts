import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './payment.entity';
import {
  ProcessPaymentDto,
  PaymentResponseDto,
  PAYMENT_PATTERNS,
} from '@app/common';
import { uuid } from 'uuidv4';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
    @Inject('ORDER_SERVICE') private orderClient: ClientProxy,
  ) {}

  async processPayment(
    processPaymentDto: ProcessPaymentDto,
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

      this.orderClient.emit(PAYMENT_PATTERNS.PAYMENT_CALLBACK, {
        orderId: payment.orderId,
        payload: response,
      });

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

      this.orderClient.emit(PAYMENT_PATTERNS.PAYMENT_CALLBACK, {
        orderId: payment.orderId,
        payload: { ...response },
      });

      return response;
    }
  }

  private async processWithExternalGateway(payment: Payment): Promise<{
    success: boolean;
    transactionId?: string;
    message?: string;
  }> {
    console.log(
      'Processing payment with external gateway for payment: ',
      payment.id,
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const success = Math.random() < 0.9;

    const transactionId = uuid();

    if (success) {
      return {
        success: true,
        transactionId: transactionId,
        message: 'Payment processed successfully',
      };
    }

    return {
      success: false,
      message: 'Payment declined by gateway',
    };
  }

  async getPaymentStatus(paymentId: string): Promise<Payment> {
    return this.paymentRepository.findOneBy({ id: paymentId });
  }

  async getPaymentByOrderId(orderId: string): Promise<Payment> {
    return this.paymentRepository.findOneBy({ orderId });
  }
}
