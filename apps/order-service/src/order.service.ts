import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timeout, catchError, retry, firstValueFrom, throwError } from 'rxjs';
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
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service';

const HTTP_CONFIG = {
  timeout: 5000,
  maxRedirects: 3,
  validateStatus: (status: number) => status < 500,
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private readonly inventoryBaseUrl = `http://${process.env.INVENTORY_HOST || 'localhost'}:${process.env.INVENTORY_PORT || 3001}`;
  private readonly paymentBaseUrl = `http://${process.env.PAYMENT_HOST || 'localhost'}:${process.env.PAYMENT_PORT || 3002}`;
  private readonly notificationBaseUrl = `http://${process.env.NOTIFICATION_HOST || 'localhost'}:${process.env.NOTIFICATION_PORT || 3004}`;
  private readonly emailBaseUrl = `http://${process.env.EMAIL_HOST || 'localhost'}:${process.env.EMAIL_PORT || 3003}`;
  private readonly analyticsBaseUrl = `http://${process.env.ANALYTICS_HOST || 'localhost'}:${process.env.ANALYTICS_PORT || 3002}`;

  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private readonly httpService: HttpService,
    private readonly circuitBreakerService: CircuitBreakerService,
    @Inject('INVENTORY_SERVICE') private inventoryClient: ClientProxy,
    @Inject('PAYMENT_SERVICE') private paymentClient: ClientProxy,
    @Inject('KAFKA_SERVICE') private kafkaClient: ClientProxy,
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
            productId: data.productId,
            quantity: data.quantity,
          })
          .pipe(
            timeout(5000),
            retry(3),
            catchError((error) => {
              this.logger.error(
                `RabbitMQ communication failed: ${JSON.stringify(error)}`,
              );
              return throwError(
                () => new RequestTimeoutException('Inventory service timeout'),
              );
            }),
          ),
      )
        .then((response) => {
          if (!response.isAvailable) {
            order.status = 'failed';
            void this.orderRepository.save(order);
            throw new BadRequestException('Insufficient inventory');
          } else {
            order.status = 'confirmed';
            void this.orderRepository.save(order);
          }
        })
        .catch((error) => {
          this.logger.error(`Async order failed: ${error}`);
          order.status = 'failed';
          void this.orderRepository.save;
        });
      return order;
    } catch (error) {
      this.logger.error(`Async order failed: ${error}`);
      order.status = 'failed';
      await this.orderRepository.save(order);
      return order;
    }
  }

  async processPaymentSync(paymentDto: ProcessPaymentDto) {
    const order = await this.getOrderById(paymentDto.orderId);
    order.status = 'payment_pending';
    await this.orderRepository.save(order);

    try {
      const response = await this.circuitBreakerService.fire(
        'payment-service',
        async () => {
          return await firstValueFrom(
            this.httpService
              .post<PaymentResponseDto>(
                `${this.paymentBaseUrl}/payment/process`,
                { ...paymentDto },
                { ...HTTP_CONFIG },
              )
              .pipe(
                timeout(5000),
                retry(3),
                catchError((error) => {
                  this.logger.error(`Payment processing failed: ${error}`);
                  throw error;
                }),
              ),
          );
        },
      );

      if (response.data.success) {
        return this.updateOrderPaymentStatus(order, response.data);
      } else {
        return this.handlePaymentError(order, response.data.message);
      }
    } catch (error) {
      if (error.type === 'open') {
        this.logger.warn(
          'Circuit breaker is open - payment service unreachable',
        );
        order.status = 'payment_pending';
        order.paymentError = 'Payment service temporarily unavailable';
        await this.orderRepository.save(order);
        throw new ServiceUnavailableException(
          'Payment service is currently unavailable, please try again later',
        );
      }

      return this.handlePaymentError(order, error || 'Unknown payment error');
    }
  }

  async processPaymentAsync(paymentDto: ProcessPaymentDto) {
    const order = await this.getOrderById(paymentDto.orderId);
    order.status = 'payment_pending';
    await this.orderRepository.save(order);

    this.paymentClient.emit(PAYMENT_PATTERNS.PROCESS_PAYMENT, {
      ...paymentDto,
    });

    return order;
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
          catchError((error) => {
            this.logger.error(`Get payment status failed: ${error}`);
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
    order.paymentError = paymentResponse.success
      ? null
      : paymentResponse.message;
    return await this.orderRepository.save(order);
  }

  async handlePaymentError(order: Order, error: string) {
    order.status = 'payment_failed';
    order.paymentError =
      typeof error === 'string' ? error : JSON.stringify(error);
    return await this.orderRepository.save(order);
  }

  async notifyServicesSync(
    order: Order,
    options: { disabledService?: string } = {},
  ) {
    const startTime = Date.now();
    const recoveryMetrics = {
      detectionTime: 0,
      recoveryStartTime: 0,
      recoveryCompleteTime: 0,
      totalRecoveryTime: 0,
      recoveryAttempts: 0,
      serviceRecoveryTimes: {},
    };

    const errorMetrics = {
      totalServices: 3,
      failedServices: 0,
      errorPropagation: 0,
      rootCauseService: null,
      propagatedErrorCount: 0,
    };

    const results = {
      services: {
        notification: {
          success: false,
          time: 0,
          error: null,
          errorPropagated: false,
        },
        email: { success: false, time: 0, error: null, errorPropagated: false },
        analytics: {
          success: false,
          time: 0,
          error: null,
          errorPropagated: false,
        },
      },
      totalTime: 0,
      recoveryMetrics,
      errorMetrics,
      completedServices: 0,
    };

    // Use temporary variables instead of modifying original properties
    let notificationUrl = this.notificationBaseUrl;
    let emailUrl = this.emailBaseUrl;
    let analyticsUrl = this.analyticsBaseUrl;

    if (options.disabledService) {
      if (options.disabledService === 'notification') {
        notificationUrl = 'http://non-existent-notification-service';
      } else if (options.disabledService === 'email') {
        emailUrl = 'http://non-existent-email-service';
      } else if (options.disabledService === 'analytics') {
        analyticsUrl = 'http://non-existent-analytics-service';
      }
    }

    try {
      const callNotificationService = async () => {
        const serviceStart = Date.now();
        let attempts = 0;
        const maxRetries = 2; // Tối đa 2 lần retry

        while (attempts <= maxRetries) {
          try {
            attempts++;
            const response = await firstValueFrom(
              this.httpService
                .post(`${notificationUrl}/notifications`, {
                  orderId: order.id,
                  customerId: order.customerId || 'unknown',
                  message: `Your order #${order.id} has been confirmed`,
                  type: 'ORDER_CONFIRMATION',
                })
                .pipe(timeout(3000)),
            );

            return {
              success: response.status === 201,
              time: Date.now() - serviceStart,
              error: null,
              retries: attempts - 1,
            };
          } catch (error) {
            this.logger.error(
              `Notification service error (attempt ${attempts}): ${error}`,
            );

            if (attempts === 1) {
              recoveryMetrics.detectionTime = Date.now() - startTime;
              recoveryMetrics.recoveryStartTime = Date.now();
            }

            if (attempts <= maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, 50 * attempts),
              );
              recoveryMetrics.recoveryAttempts++;
            } else {
              return {
                success: false,
                time: Date.now() - serviceStart,
                error: error.message || 'Unknown error',
                retries: attempts - 1,
              };
            }
          }
        }
      };

      const callEmailService = async () => {
        const serviceStart = Date.now();
        let attempts = 0;
        const maxRetries = 1;

        while (attempts <= maxRetries) {
          try {
            attempts++;
            const response = await firstValueFrom(
              this.httpService
                .post(`${emailUrl}/emails`, {
                  orderId: order.id,
                  customerId: order.customerId || 'unknown',
                  subject: `Order Confirmation: #${order.id}`,
                  body: `Thank you for your order #${order.id}. Your order has been confirmed.`,
                })
                .pipe(timeout(3000)),
            );

            return {
              success: response.status === 201,
              time: Date.now() - serviceStart,
              error: null,
              retries: attempts - 1,
            };
          } catch (error) {
            this.logger.error(
              `Email service error (attempt ${attempts}): ${error}`,
            );

            if (errorMetrics.rootCauseService === null) {
              errorMetrics.rootCauseService = 'email';
            }

            if (attempts <= maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, 50 * attempts),
              );
              recoveryMetrics.recoveryAttempts++;
            } else {
              return {
                success: false,
                time: Date.now() - serviceStart,
                error: error.message || 'Unknown error',
                retries: attempts - 1,
              };
            }
          }
        }
      };

      const callAnalyticsService = async () => {
        const serviceStart = Date.now();

        try {
          const response = await firstValueFrom(
            this.httpService
              .post(`${analyticsUrl}/events`, {
                orderId: order.id,
                customerId: order.customerId || 'unknown',
                event: 'ORDER_CONFIRMED',
                metadata: {
                  productId: order.productId,
                  quantity: order.quantity,
                },
              })
              .pipe(timeout(3000)),
          );

          return {
            success: response.status === 201,
            time: Date.now() - serviceStart,
            error: null,
            retries: 0,
          };
        } catch (error) {
          this.logger.error(`Analytics service error: ${error}`);

          if (errorMetrics.rootCauseService === null) {
            errorMetrics.rootCauseService = 'analytics';
          }

          return {
            success: false,
            time: Date.now() - serviceStart,
            error: error.message || 'Unknown error',
            retries: 0,
          };
        }
      };

      const [notificationResult, emailResult, analyticsResult] =
        await Promise.allSettled([
          callNotificationService(),
          callEmailService(),
          callAnalyticsService(),
        ]);

      if (notificationResult.status === 'fulfilled') {
        results.services.notification = {
          ...notificationResult.value,
          errorPropagated: false,
        };

        if (notificationResult.value.success) {
          results.completedServices++;
        } else {
          errorMetrics.failedServices++;
          if (errorMetrics.rootCauseService === null) {
            errorMetrics.rootCauseService = 'notification';
          }
        }
      }

      if (emailResult.status === 'fulfilled') {
        const isErrorPropagated =
          !emailResult.value.success &&
          errorMetrics.rootCauseService &&
          errorMetrics.rootCauseService !== 'email' &&
          !(
            typeof emailResult.value.error === 'string' &&
            emailResult.value.error.includes('timeout')
          ) &&
          !(
            typeof emailResult.value.error === 'string' &&
            emailResult.value.error.includes('refused')
          );

        results.services.email = {
          ...emailResult.value,
          errorPropagated: isErrorPropagated,
        };

        if (emailResult.value.success) {
          results.completedServices++;
        } else {
          errorMetrics.failedServices++;
          if (isErrorPropagated) {
            errorMetrics.propagatedErrorCount++;
          }
        }
      }

      if (analyticsResult.status === 'fulfilled') {
        const isErrorPropagated =
          !analyticsResult.value.success &&
          errorMetrics.rootCauseService &&
          errorMetrics.rootCauseService !== 'analytics' &&
          !(
            typeof analyticsResult.value.error === 'string' &&
            analyticsResult.value.error.includes('timeout')
          ) &&
          !(
            typeof analyticsResult.value.error === 'string' &&
            analyticsResult.value.error.includes('refused')
          );

        results.services.analytics = {
          ...analyticsResult.value,
          errorPropagated: isErrorPropagated,
        };

        if (analyticsResult.value.success) {
          results.completedServices++;
        } else {
          errorMetrics.failedServices++;
          if (isErrorPropagated) {
            errorMetrics.propagatedErrorCount++;
          }
        }
      }

      if (recoveryMetrics.recoveryStartTime > 0) {
        recoveryMetrics.recoveryCompleteTime = Date.now();
        recoveryMetrics.totalRecoveryTime =
          recoveryMetrics.recoveryCompleteTime -
          recoveryMetrics.recoveryStartTime;
      }

      if (errorMetrics.failedServices > 0) {
        if (errorMetrics.failedServices > 1) {
          errorMetrics.errorPropagation =
            errorMetrics.propagatedErrorCount /
            (errorMetrics.failedServices - 1);
        } else {
          errorMetrics.errorPropagation = 0;
        }
      }

      results.totalTime = Date.now() - startTime;
      return {
        ...results,
        flowSuccess: results.completedServices === 3,
        partialSuccess: results.completedServices > 0,
        hasErrors: errorMetrics.failedServices > 0,
      };
    } catch (error) {
      this.logger.error(`Failed to notify services: ${error}`);
      throw error;
    }
  }

  // Asynchronous approach - Publish event once
  async notifyServicesAsync(order: Order) {
    const startTime = Date.now();

    try {
      // Publish single event to Kafka
      await firstValueFrom(
        this.kafkaClient
          .emit('order_confirmed', {
            orderId: order.id,
            customerId: order.customerId,
            status: order.status,
            productId: order.productId,
            quantity: order.quantity,
            timestamp: new Date().toISOString(),
          })
          .pipe(
            timeout(5000),
            catchError((error) => {
              this.logger.error(`Failed to emit event: ${error}`);
              throw error;
            }),
          ),
      );

      return {
        success: true,
        time: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        time: Date.now() - startTime,
        error: error as string,
      };
    }
  }
}
