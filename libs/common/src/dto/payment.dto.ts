export class ProcessPaymentDto {
  orderId!: string;
  quantity!: number;
  currency?: string = "USD";
}

export class PaymentResponseDto {
  success!: boolean;
  transactionId?: string;
  message?: string;
  paymentId?: string;
  status?: string;
}
