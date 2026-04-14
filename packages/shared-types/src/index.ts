export type TargetStatus = 'IDLE' | 'LOADING' | 'ACTIVE' | 'EXPIRED' | 'ERROR';

export interface Target {
  id: string;
  url: string;
  cookies: string;
  refreshInterval: number;
  isActive: boolean;
  status: TargetStatus;
  lastRun?: Date;
  createdAt: Date;
}

export interface ActivityLog {
  id: string;
  targetId: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  timestamp: Date;
}
