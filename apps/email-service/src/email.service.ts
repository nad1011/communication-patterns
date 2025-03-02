import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Email } from './email.entity';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectRepository(Email)
    private emailRepository: Repository<Email>,
  ) {}

  async sendEmail(data: {
    orderId: string;
    customerId: string;
    subject: string;
    body: string;
  }) {
    this.logger.log(`Sending email for order: ${data.orderId}`);

    // In a real system, this would integrate with an email provider like SendGrid or AWS SES
    // For demo purposes, we're just logging and saving to the database

    const email = this.emailRepository.create({
      orderId: data.orderId,
      customerId: data.customerId,
      subject: data.subject,
      body: data.body,
      sent: true,
      sentAt: new Date(),
    });

    await this.emailRepository.save(email);

    return email;
  }
}
