import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
  ) {}

  async sendNotification(data: {
    orderId: string;
    customerId: string;
    message: string;
    type: string;
  }) {
    this.logger.log(`Sending notification for order: ${data.orderId}`);

    // In a real system, this would integrate with a push notification provider
    // For demo purposes, we're just logging and saving to the database

    const notification = this.notificationRepository.create({
      orderId: data.orderId,
      customerId: data.customerId,
      message: data.message,
      type: data.type,
      sent: true,
      sentAt: new Date(),
    });

    await this.notificationRepository.save(notification);

    return notification;
  }
}
