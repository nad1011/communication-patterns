import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { ActivityDto } from './dto/activity.dto';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    @Inject('FRAUD_SERVICE') private readonly fraudClient: ClientProxy,
    @Inject('ANALYTICS_SERVICE') private readonly analyticsClient: ClientProxy,
    @Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientProxy,
  ) {}

  getHello(): string {
    return 'Activity Service is running!';
  }

  async trackActivityRabbitMQ(activityDto: ActivityDto): Promise<{
    success: boolean;
    message: string;
    timestamp: string;
  }> {
    this.logger.log(
      `[RabbitMQ] Tracking activity: ${JSON.stringify(activityDto)}`,
    );

    const enrichedActivity = {
      ...activityDto,
      timestamp: new Date().toISOString(),
    };

    try {
      if (activityDto.action === 'click') {
        await firstValueFrom(
          this.fraudClient.send('user_click', enrichedActivity),
        );
        this.logger.log(
          `Sent click event to fraud service: ${JSON.stringify(enrichedActivity)}`,
        );
      } else if (activityDto.action === 'search') {
        await firstValueFrom(
          this.analyticsClient.send('user_search', enrichedActivity),
        );
        this.logger.log(
          `Sent search event to analytics service: ${JSON.stringify(enrichedActivity)}`,
        );
      }

      return {
        success: true,
        message: `Activity tracked via RabbitMQ: ${activityDto.action}`,
        timestamp: enrichedActivity.timestamp,
      };
    } catch (error) {
      this.logger.error(
        `Error tracking activity via RabbitMQ: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async trackActivityKafka(activityDto: ActivityDto): Promise<{
    success: boolean;
    message: string;
    timestamp: string;
  }> {
    this.logger.log(
      `[Kafka] Tracking activity: ${JSON.stringify(activityDto)}`,
    );

    const enrichedActivity = {
      ...activityDto,
      timestamp: new Date().toISOString(),
    };

    try {
      // With Kafka, we publish to a topic and multiple services can consume
      await firstValueFrom(
        this.kafkaClient.emit('user_activity', enrichedActivity),
      );
      this.logger.log(
        `Published event to Kafka: ${JSON.stringify(enrichedActivity)}`,
      );

      return {
        success: true,
        message: `Activity published to Kafka topic: ${activityDto.action}`,
        timestamp: enrichedActivity.timestamp,
      };
    } catch (error) {
      this.logger.error(
        `Error publishing activity to Kafka: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
