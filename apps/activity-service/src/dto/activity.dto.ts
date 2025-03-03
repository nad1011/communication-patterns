export class ActivityDto {
  userId: string;
  action: 'click' | 'view' | 'search';
  resourceId: string;
  metadata?: Record<string, any>;
}
