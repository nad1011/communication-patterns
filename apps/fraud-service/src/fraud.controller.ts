import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, EventPattern, Payload } from '@nestjs/microservices';
import { FraudService } from './fraud.service';

@Controller()
export class FraudController {
  private readonly logger = new Logger(FraudController.name);

  constructor(private readonly appService: FraudService) {}

  // RabbitMQ Message Pattern Handler (One-to-One)
  @MessagePattern('user_click')
  handleUserClick(@Payload() data: any) {
    this.logger.log(`[RabbitMQ] Received user click: ${JSON.stringify(data)}`);
    return this.appService.analyzeUserActivity(data);
  }

  // Kafka Event Pattern Handler (One-to-Many)
  @EventPattern('user_activity')
  handleUserActivity(@Payload() data: any) {
    this.logger.log(`[Kafka] Received user activity: ${JSON.stringify(data)}`);

    // Only process click actions in fraud detection service
    if (data.value.action === 'click') {
      return this.appService.analyzeUserActivity(data.value);
    }

    this.logger.log(`Ignoring non-click activity: ${data.value.action}`);
    return null;
  }
}
