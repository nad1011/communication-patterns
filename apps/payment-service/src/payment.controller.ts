import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { PaymentService } from './payment.service';
import {
  ProcessPaymentDto,
  PaymentResponseDto,
  PAYMENT_PATTERNS,
} from '@app/common';

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('process')
  async processPaymentSync(
    @Body() processPaymentDto: ProcessPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentService.processPayment(processPaymentDto);
  }

  @Get(':paymentId')
  async getPaymentStatus(@Param('paymentId') paymentId: string) {
    return this.paymentService.getPaymentStatus(paymentId);
  }

  @MessagePattern(PAYMENT_PATTERNS.PROCESS_PAYMENT)
  async processPaymentAsync(
    data: ProcessPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentService.processPayment(data);
  }
}
