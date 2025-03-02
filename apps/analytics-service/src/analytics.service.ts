import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsEvent } from './analytics.entity';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(AnalyticsEvent)
    private eventRepository: Repository<AnalyticsEvent>,
  ) {}

  async trackEvent(data: {
    orderId: string;
    customerId: string;
    event: string;
    metadata: any;
  }) {
    this.logger.log(`Tracking event: ${data.event} for order: ${data.orderId}`);

    // In a real system, this might send data to an analytics platform like Google Analytics
    // For demo purposes, we're just logging and saving to the database

    const event = this.eventRepository.create({
      orderId: data.orderId,
      customerId: data.customerId,
      eventType: data.event,
      metadata: data.metadata,
      processed: true,
      processedAt: new Date(),
    });

    await this.eventRepository.save(event);

    return event;
  }
}
