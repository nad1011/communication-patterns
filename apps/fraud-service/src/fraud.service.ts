import { Injectable } from '@nestjs/common';

interface FraudStats {
  totalActivities: number;
  suspiciousActivities: number;
  activitiesByUser: Map<string, number>;
  lastProcessedAt: string;
}

@Injectable()
export class FraudService {
  private stats: FraudStats = {
    totalActivities: 0,
    suspiciousActivities: 0,
    activitiesByUser: new Map<string, number>(),
    lastProcessedAt: new Date().toISOString(),
  };

  getHello(): string {
    return 'Fraud Detection Service is running!';
  }

  getStats() {
    return {
      totalActivities: this.stats.totalActivities,
      suspiciousActivities: this.stats.suspiciousActivities,
      activitiesByUser: Object.fromEntries(this.stats.activitiesByUser),
      lastProcessedAt: this.stats.lastProcessedAt,
    };
  }

  analyzeUserActivity(data: any): any {
    this.stats.totalActivities++;
    this.stats.lastProcessedAt = new Date().toISOString();

    if (!this.stats.activitiesByUser.has(data.userId)) {
      this.stats.activitiesByUser.set(data.userId, 0);
    }
    this.stats.activitiesByUser.set(
      data.userId,
      this.stats.activitiesByUser.get(data.userId) + 1,
    );

    const isSuspicious = Math.random() < 0.2;

    if (isSuspicious) {
      this.stats.suspiciousActivities++;
    }

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

    return result;
  }
}
