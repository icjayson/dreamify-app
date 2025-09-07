// API Configuration
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
} as const;

// API Endpoints
export const API_ENDPOINTS = {
  // File Upload
  UPLOAD_FILE: '/api/upload',
  
  // Analytics
  ANALYTICS: '/api/analytics',
  ANALYTICS_SUMMARY: '/api/analytics/summary',
  ANALYTICS_CHARTS: '/api/analytics/charts',
  ANALYTICS_DATA: '/api/v1/analytics/data',
  
  // Dashboard
  DASHBOARD_GENERATE: '/api/v1/dashboard/generate',
  DASHBOARD_CONFIG: '/api/v1/dashboard/config',
  DASHBOARD_REFRESH: '/api/v1/dashboard/refresh',
  DASHBOARD_CHART_DATA: '/api/v1/dashboard/chart-data',
  DASHBOARD_LIST: '/api/v1/dashboard/list',
  DASHBOARD_DELETE: '/api/v1/dashboard/delete',
  
  // Health Check
  HEALTH: '/api/health',
} as const;

// HTTP Methods
export const HTTP_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
} as const;

// Content Types
export const CONTENT_TYPES = {
  JSON: 'application/json',
  FORM_DATA: 'multipart/form-data',
  TEXT: 'text/plain',
} as const;
