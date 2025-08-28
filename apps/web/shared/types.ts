// Shared TypeScript types for the Animato Data Analytics Platform

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
}

// File Upload Types
export interface FileUploadData {
  filename: string;
  original_filename: string;
  file_size: number;
  file_type: string;
  upload_date: string;
  processed: 'pending' | 'processing' | 'completed' | 'failed';
  columns?: string[];
  row_count: number;
  error_message?: string;
}

export interface FileUploadResponse {
  success: boolean;
  message: string;
  data: {
    filename: string;
    records: number;
    columns: string[];
    size: number;
  };
}

// Analytics Types
export interface AnalyticsSummary {
  total_records: number;
  total_revenue: number;
  average_order_value: number;
  top_product: string;
  top_category: string;
  processing_time?: number;
}

export interface ChartData {
  type: 'line' | 'bar' | 'pie' | 'area';
  title: string;
  data: any[];
  config?: {
    color?: string;
    height?: number;
    width?: number;
    [key: string]: any;
  };
}

export interface MetricData {
  label: string;
  value: number;
  change: number;
  trend: 'up' | 'down' | 'stable';
}

export interface AnalyticsData {
  summary: AnalyticsSummary;
  charts: ChartData[];
  metrics: MetricData[];
}

// Health Check Types
export interface HealthCheckData {
  status: 'healthy' | 'unhealthy';
  version: string;
  uptime?: number;
  database?: string;
  services?: string[];
}

// Error Types
export interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: Record<string, any>;
}

// Validation Types
export interface ValidationError {
  field: string;
  message: string;
  code?: string;
}

// Processing Job Types
export interface ProcessingJob {
  id: string;
  file_upload_id: number;
  job_type: 'upload' | 'process' | 'analyze';
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  progress: number;
}

// Common Types
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface PaginationParams {
  page: number;
  limit: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// Form Types
export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password' | 'number' | 'select' | 'textarea' | 'file';
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

// UI Types
export interface Theme {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'viewer';
  created_at: string;
  last_login?: string;
}

// Notification Types
export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// Export all types
export type {
  ApiResponse,
  FileUploadData,
  FileUploadResponse,
  AnalyticsSummary,
  ChartData,
  MetricData,
  AnalyticsData,
  HealthCheckData,
  ApiError,
  ValidationError,
  ProcessingJob,
  LoadingState,
  PaginationParams,
  PaginatedResponse,
  FormField,
  Theme,
  User,
  Notification,
};
