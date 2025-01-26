import {
  BadRequestException,
  Inject,
  Injectable,
  RequestTimeoutException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timeout, catchError } from 'rxjs';
import { Repository } from 'typeorm';
import { Order } from './order.entity';
import { HttpService } from '@nestjs/axios';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { InventoryResponse } from './types';

@Injectable()
export class OrderService {
  private readonly inventoryBaseUrl = 'http://localhost:3001';

  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private readonly httpService: HttpService,
    @Inject('INVENTORY_SERVICE') private inventoryClient: ClientProxy,
    @Inject('KAFKA_SERVICE') private kafkaClient: ClientProxy,
  ) {}

  async createOrderSync(data: { productId: string; quantity: number }) {
    try {
      const response = await lastValueFrom(
        this.httpService.get<InventoryResponse>(
          `${this.inventoryBaseUrl}/inventory/check/${data.productId}`,
        ),
      );

      if (response.data.quantity < data.quantity) {
        throw new BadRequestException('Insufficient inventory');
      }

      const order = this.orderRepository.create({
        productId: data.productId,
        quantity: data.quantity,
        status: 'created',
      });

      await this.orderRepository.save(order);

      await lastValueFrom(
        this.httpService.post<InventoryResponse>(
          `${this.inventoryBaseUrl}/inventory/update`,
          {
            productId: data.productId,
            quantity: data.quantity,
            orderId: order.id,
          },
        ),
      );

      return order;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to process order',
      );
    }
  }

  async createOrderAsync(data: { productId: string; quantity: number }) {
    const order = this.orderRepository.create({
      productId: data.productId,
      quantity: data.quantity,
      status: 'pending',
    });

    await this.orderRepository.save(order);

    try {
      await lastValueFrom(
        this.inventoryClient
          .send<InventoryResponse>('check_inventory', {
            orderId: order.id,
            productId: data.productId,
            quantity: data.quantity,
          })
          .pipe(
            timeout(5000),
            catchError((error) => {
              throw new RequestTimeoutException(
                error instanceof Error
                  ? error.message
                  : 'Inventory service timeout',
              );
            }),
          ),
      );

      order.status = 'confirmed';
      await this.orderRepository.save(order);
      return order;
    } catch (error) {
      order.status = 'failed';
      await this.orderRepository.save(order);
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to process order',
      );
    }
  }

  async createOrderEvent(data: { productId: string; quantity: number }) {
    try {
      const order = this.orderRepository.create({
        productId: data.productId,
        quantity: data.quantity,
        status: 'pending',
      });

      await this.orderRepository.save(order);

      await lastValueFrom(
        this.kafkaClient.emit('order_created', {
          orderId: order.id,
          productId: data.productId,
          quantity: data.quantity,
        }),
      );

      return order;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to create order event',
      );
    }
  }
}
