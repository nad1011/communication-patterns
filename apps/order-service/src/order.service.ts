import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timeout, catchError, retry, firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { Order } from './order.entity';
import { HttpService } from '@nestjs/axios';
import { ClientProxy } from '@nestjs/microservices';
import { InventoryResponse } from './types';
import {
  ProcessPaymentDto,
  PaymentResponseDto,
  PAYMENT_PATTERNS,
} from '@app/common';

const HTTP_CONFIG = {
  timeout: 5000,
  maxRedirects: 3,
  validateStatus: (status: number) => status < 500,
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private readonly inventoryBaseUrl = 'http://localhost:3001';
  private readonly paymentBaseUrl = 'http://localhost:3002';

  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private readonly httpService: HttpService,
    @Inject('INVENTORY_SERVICE') private inventoryClient: ClientProxy,
    @Inject('PAYMENT_SERVICE') private paymentClient: ClientProxy,
  ) {}

  private validateQuantity(quantity: number) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Quantity must be a positive integer');
    }
  }

  async getOrderById(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    return order;
  }

  async createOrderSync(data: { productId: string; quantity: number }) {
    this.validateQuantity(data.quantity);

    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        const response = await firstValueFrom(
          this.httpService
            .get<InventoryResponse>(
              `${this.inventoryBaseUrl}/inventory/check/${data.productId}`,
              { ...HTTP_CONFIG },
            )
            .pipe(
              retry(3),
              catchError((error: Error) => {
                this.logger.error(`Inventory check failed: ${error.message}`);
                throw new ServiceUnavailableException(
                  'Inventory service unavailable',
                );
              }),
            ),
        );

        if (response.data.quantity < data.quantity) {
          throw new BadRequestException('Insufficient inventory');
        }

        const order = manager.create(Order, {
          productId: data.productId,
          quantity: data.quantity,
          status: 'created',
        });

        try {
          await firstValueFrom(
            this.httpService
              .post<InventoryResponse>(
                `${this.inventoryBaseUrl}/inventory/update`,
                {
                  productId: data.productId,
                  quantity: data.quantity,
                  orderId: order.id,
                },
                { ...HTTP_CONFIG },
              )
              .pipe(retry(3)),
          );
          order.status = 'confirmed';
        } catch (error) {
          order.status = 'failed';
          this.logger.error(
            `Inventory update failed: ${(error as Error).message}`,
          );
          throw new ServiceUnavailableException('Failed to update inventory');
        }
        await manager.save(Order, order);

        return order;
      });
    } catch (error) {
      this.logger.error(`Order creation failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async createOrderAsync(data: { productId: string; quantity: number }) {
    this.validateQuantity(data.quantity);

    const order = this.orderRepository.create({
      productId: data.productId,
      quantity: data.quantity,
      status: 'pending',
    });

    await this.orderRepository.save(order);

    try {
      void firstValueFrom(
        this.inventoryClient
          .send<InventoryResponse>('check_update_inventory', {
            orderId: order.id,
            productId: data.productId,
            quantity: data.quantity,
          })
          .pipe(
            timeout(5000),
            retry(3),
            catchError((error: Error) => {
              this.logger.error(
                `RabbitMQ communication failed: ${error.message}`,
              );
              throw new RequestTimeoutException('Inventory service timeout');
            }),
          ),
      ).then((response) => {
        if (!response.isAvailable) {
          order.status = 'failed';
          void this.orderRepository.save(order);
          throw new BadRequestException('Insufficient inventory');
        } else {
          order.status = 'confirmed';
          void this.orderRepository.save(order);
        }
      });
      return order;
    } catch (error) {
      this.logger.error(`Async order failed: ${(error as Error).message}`);
      order.status = 'failed';
      await this.orderRepository.save(order);
      throw error;
    }
  }

  async processPaymentSync(paymentDto: ProcessPaymentDto) {
    const order = await this.getOrderById(paymentDto.orderId);
    order.status = 'payment_pending';
    await this.orderRepository.save(order);

    const response = await firstValueFrom(
      this.httpService
        .post<PaymentResponseDto>(
          `${this.paymentBaseUrl}/payment/process`,
          {
            ...paymentDto,
          },
          { ...HTTP_CONFIG },
        )
        .pipe(
          timeout(5000),
          retry(3),
          catchError((error: Error) => {
            this.logger.error(`Payment processing failed: ${error.message}`);
            throw error;
          }),
        ),
    );

    return response.data;
  }

  async processPaymentAsync(paymentDto: ProcessPaymentDto) {
    const order = await this.getOrderById(paymentDto.orderId);
    order.status = 'payment_pending';
    await this.orderRepository.save(order);

    this.paymentClient.emit(PAYMENT_PATTERNS.PROCESS_PAYMENT, {
      ...paymentDto,
    });

    return {
      orderId: order.id,
      status: 'payment_pending',
      message: 'Payment processing initiated',
    };
  }

  async getPaymentStatus(transactionId: string) {
    const response = await firstValueFrom(
      this.httpService
        .get(`${this.paymentBaseUrl}/payment/${transactionId}`, {
          ...HTTP_CONFIG,
        })
        .pipe(
          timeout(5000),
          retry(3),
          catchError((error: Error) => {
            this.logger.error(`Get payment status failed: ${error.message}`);
            throw error;
          }),
        ),
    );

    return response;
  }

  async updateOrderPaymentStatus(
    order: Order,
    paymentResponse: PaymentResponseDto,
  ) {
    order.status = paymentResponse.success ? 'paid' : 'payment_failed';
    order.paymentId = paymentResponse.paymentId;
    order.paymentStatus = paymentResponse.status;

    if (!paymentResponse.success) {
      order.paymentError = paymentResponse.message;
    }

    await this.orderRepository.save(order);
  }

  async handlePaymentError(order: Order, error: string) {
    order.status = 'payment_failed';
    order.paymentError = error || 'Payment processing failed';
    await this.orderRepository.save(order);
  }
}
