const LOCAL_API_BASE_URL = 'http://localhost:5000';

export const getApiBaseUrl = (
  configuredUrl = process.env.NEXT_PUBLIC_API_URL,
  nodeEnv = process.env.NODE_ENV,
) => {
  const normalizedUrl = configuredUrl?.trim().replace(/\/+$/, '');
  if (normalizedUrl) return normalizedUrl;

  // The documented local bootstrap runs FastAPI on port 5000. Without this
  // fallback, API calls hit the Next.js catch-all route and return an HTML 404.
  return nodeEnv === 'development' ? LOCAL_API_BASE_URL : '';
};

// API Configuration
export const API_CONFIG = {
  BASE_URL: getApiBaseUrl(),
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
} as const;

// API Endpoints
export const API_ENDPOINTS = {
  // File Upload
  UPLOAD_FILE: '/api/v1/files/upload',

  // Analytics
  ANALYTICS: '/api/v1/analytics',
  ANALYTICS_SUMMARY: '/api/v1/analytics/summary',
  ANALYTICS_CHARTS: '/api/v1/analytics/charts',
  ANALYTICS_DATA: '/api/v1/analytics/data',

  // Dashboard (aligned with FastAPI backend)
  DASHBOARD_GENERATE: '/api/v1/dashboard/generate',
  DASHBOARD_CONFIG: '/api/v1/dashboard/config',
  DASHBOARD_REFRESH: '/api/v1/dashboard/refresh',
  DASHBOARD_CHART_DATA: '/api/v1/dashboard/chart-data',
  DASHBOARD_LIST: '/api/v1/dashboard/list',
  DASHBOARD_DELETE: '/api/v1/dashboard/delete',

  // Health Check
  HEALTH: '/health',

  // Admin
  ADMIN_CONVERSATIONS: '/api/v1/admin/conversations',
  ADMIN_CONVERSATION: '/api/v1/admin/conversations',
  ADMIN_CONVERSATION_NODES: '/api/v1/admin/conversations',
  ADMIN_METRICS: '/api/v1/admin/metrics',
  ADMIN_TIMESERIES: '/api/v1/admin/metrics/timeseries',
  ADMIN_USERS: '/api/v1/admin/users',

  // Blog (public reads)
  BLOG_POSTS: '/api/v1/blog/posts',

  // Blog CMS (admin)
  CMS_POSTS: '/api/v1/admin/blog/posts',
  CMS_ASSETS: '/api/v1/admin/blog/assets',
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
