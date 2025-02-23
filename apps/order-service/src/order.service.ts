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

const HTTP_CONFIG = {
  timeout: 5000,
  maxRedirects: 3,
  validateStatus: (status: number) => status < 500,
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private readonly inventoryBaseUrl = 'http://localhost:3001';

  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private readonly httpService: HttpService,
    @Inject('INVENTORY_SERVICE') private inventoryClient: ClientProxy,
    @Inject('KAFKA_SERVICE') private kafkaClient: ClientProxy,
  ) {}

  private validateQuantity(quantity: number) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Quantity must be a positive integer');
    }
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

        await manager.save(Order, order);

        // Update inventory with retries
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
        } catch (error) {
          this.logger.error(
            `Inventory update failed: ${(error as Error).message}`,
          );
          throw new ServiceUnavailableException('Failed to update inventory');
        }

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
            catchError((error) => {
              this.logger.error(
                `RabbitMQ communication failed: ${(error as Error).message}`,
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

  async getOrdersStatus(orderId: string) {
    return this.orderRepository.findOneBy({ id: orderId });
  }
}
