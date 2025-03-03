import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  getHello(): string {
    return 'Fraud Detection Service is running!';
  }

  analyzeUserActivity(data: any): any {
    this.logger.log(`Analyzing activity for fraud: ${JSON.stringify(data)}`);

    // Simulate fraud detection analysis
    const isSuspicious = Math.random() < 0.2;

    const result = {
      activityId: data.userId + '-' + new Date().getTime(),
      userId: data.userId,
      action: data.action,
      resourceId: data.resourceId,
      timestamp: data.timestamp || new Date().toISOString(),
      fraudAnalysis: {
        isSuspicious,
        riskScore: isSuspicious
          ? Math.floor(Math.random() * 100) + 70
          : Math.floor(Math.random() * 50),
        reason: isSuspicious
          ? 'Unusual activity pattern detected'
          : 'No suspicious patterns',
      },
    };

    this.logger.log(
      `Fraud analysis result: ${JSON.stringify(result.fraudAnalysis)}`,
    );
    return result;
  }
}
