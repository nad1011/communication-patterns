import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsEvent } from './analytics.entity';

interface ActivityCount {
  click: number;
  view: number;
  search: number;
}

interface ActivityStats {
  totalActivities: number;
  activityCounts: ActivityCount;
  userStats: Map<string, ActivityCount>;
  topSearchTerms: Map<string, number>;
  lastProcessedAt: string;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private stats: ActivityStats = {
    totalActivities: 0,
    activityCounts: {
      click: 0,
      view: 0,
      search: 0,
    },
    userStats: new Map<string, ActivityCount>(),
    topSearchTerms: new Map<string, number>(),
    lastProcessedAt: new Date().toISOString(),
  };
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

  getStats() {
    // Convert maps to objects for API response
    return {
      totalActivities: this.stats.totalActivities,
      activityCounts: this.stats.activityCounts,
      userStats: Object.fromEntries(this.stats.userStats),
      topSearchTerms: Object.fromEntries(this.stats.topSearchTerms),
      lastProcessedAt: this.stats.lastProcessedAt,
    };
  }

  logActivity(data: any) {
    this.logger.log(`Logging activity: ${JSON.stringify(data)}`);

    // Update total count
    this.stats.totalActivities++;

    // Update activity type count
    if (
      data.action === 'click' ||
      data.action === 'view' ||
      data.action === 'search'
    ) {
      this.stats.activityCounts[data.action]++;
    }

    // Update user stats
    if (!this.stats.userStats.has(data.userId)) {
      this.stats.userStats.set(data.userId, { click: 0, view: 0, search: 0 });
    }

    const userStats = this.stats.userStats.get(data.userId);
    if (
      data.action === 'click' ||
      data.action === 'view' ||
      data.action === 'search'
    ) {
      userStats[data.action]++;
    }

    this.stats.lastProcessedAt = new Date().toISOString();
  }

  processUserSearch(data: any) {
    this.logger.log(`Processing search activity: ${JSON.stringify(data)}`);

    // Extract search term from metadata (in a real app, this would be structured)
    const searchTerm = data.metadata?.term || 'unknown';

    // Update search term stats
    const currentCount = this.stats.topSearchTerms.get(searchTerm) || 0;
    this.stats.topSearchTerms.set(searchTerm, currentCount + 1);

    // Sort search terms by frequency for reporting
    const sortedTerms = [...this.stats.topSearchTerms.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10 terms

    const result = {
      userId: data.userId,
      searchTerm,
      timestamp: data.timestamp || new Date().toISOString(),
      searchRank: sortedTerms.findIndex(([term]) => term === searchTerm) + 1,
      totalSearches: this.stats.activityCounts.search,
    };

    this.logger.log(`Search processed: ${JSON.stringify(result)}`);
    return result;
  }
}
