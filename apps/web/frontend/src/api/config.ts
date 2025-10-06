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
  
  // Dashboard (keep base URL unchanged; align paths with backend)
  DASHBOARD_GENERATE: '/api/dashboard/generate',
  DASHBOARD_CONFIG: '/api/dashboard/config',
  DASHBOARD_REFRESH: '/api/dashboard/refresh',
  DASHBOARD_CHART_DATA: '/api/dashboard/chart-data',
  DASHBOARD_LIST: '/api/dashboard/list',
  DASHBOARD_DELETE: '/api/dashboard/delete',
  
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
