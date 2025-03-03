import { Body, Controller, Post } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { ActivityDto } from './dto/activity.dto';

@Controller()
export class ActivityController {
  constructor(private readonly appService: ActivityService) {}

  @Post('track/rabbitmq')
  async trackActivityRabbitMQ(@Body() activityDto: ActivityDto) {
    return this.appService.trackActivityRabbitMQ(activityDto);
  }

  @Post('track/kafka')
  async trackActivityKafka(@Body() activityDto: ActivityDto) {
    return this.appService.trackActivityKafka(activityDto);
  }
}
