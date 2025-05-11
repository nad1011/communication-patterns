import { Controller, Get, Logger } from '@nestjs/common';
import { MessagePattern, EventPattern, Payload } from '@nestjs/microservices';
import { FraudService } from './fraud.service';

@Controller()
export class FraudController {
  private readonly logger = new Logger(FraudController.name);

  constructor(private readonly appService: FraudService) {}

  @Get('stats')
  getStats() {
    return this.appService.getStats();
  }

  @MessagePattern('user_click')
  handleUserClick(@Payload() data: any) {
    return this.appService.analyzeUserActivity(data);
  }

  @EventPattern('user_activity')
  handleUserActivity(@Payload() data: any) {
    if (data.value.action === 'click') {
      return this.appService.analyzeUserActivity(data.value);
    }

    this.logger.log(`Ignoring non-click activity: ${data.value.action}`);
    return null;
  }
}
