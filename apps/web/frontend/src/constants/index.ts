// Application Constants
export const APP_CONFIG = {
  NAME: 'Animato Data Analytics',
  VERSION: '1.0.0',
  DESCRIPTION: 'A full-stack analytics platform for data processing and visualization',
} as const;

// File Upload Constants
export const FILE_CONFIG = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['csv', 'xlsx', 'xls'],
  ALLOWED_MIME_TYPES: [
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ],
} as const;

// Chart Configuration
export const CHART_CONFIG = {
  COLORS: {
    PRIMARY: '#3b82f6',
    SECONDARY: '#10b981',
    ACCENT: '#f59e0b',
    DANGER: '#ef4444',
    WARNING: '#f97316',
    INFO: '#06b6d4',
  },
  ANIMATION_DURATION: 1000,
  RESPONSIVE: true,
} as const;

// UI Constants
export const UI_CONFIG = {
  BREAKPOINTS: {
    SM: 640,
    MD: 768,
    LG: 1024,
    XL: 1280,
    '2XL': 1536,
  },
  SPACING: {
    XS: '0.25rem',
    SM: '0.5rem',
    MD: '1rem',
    LG: '1.5rem',
    XL: '2rem',
    '2XL': '3rem',
  },
  BORDER_RADIUS: {
    SM: '0.25rem',
    MD: '0.375rem',
    LG: '0.5rem',
    XL: '0.75rem',
    FULL: '9999px',
  },
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  FILE_UPLOAD: {
    INVALID_TYPE: 'Please upload a valid CSV or Excel file',
    TOO_LARGE: 'File size must be less than 10MB',
    UPLOAD_FAILED: 'Failed to upload file. Please try again.',
  },
  API: {
    NETWORK_ERROR: 'Network error. Please check your connection.',
    SERVER_ERROR: 'Server error. Please try again later.',
    UNAUTHORIZED: 'Unauthorized access.',
    NOT_FOUND: 'Resource not found.',
  },
  VALIDATION: {
    REQUIRED: 'This field is required',
    INVALID_EMAIL: 'Please enter a valid email address',
    MIN_LENGTH: 'Minimum length is {min} characters',
    MAX_LENGTH: 'Maximum length is {max} characters',
  },
} as const;

// Success Messages
export const SUCCESS_MESSAGES = {
  FILE_UPLOAD: 'File uploaded successfully',
  DATA_PROCESSED: 'Data processed successfully',
  SAVED: 'Changes saved successfully',
  DELETED: 'Item deleted successfully',
} as const;

// Loading States
export const LOADING_STATES = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
} as const;

// Date Formats
export const DATE_FORMATS = {
  DISPLAY: 'MMM dd, yyyy',
  API: 'yyyy-MM-dd',
  TIMESTAMP: 'yyyy-MM-dd HH:mm:ss',
  SHORT: 'MM/dd/yyyy',
} as const;

// Number Formats
export const NUMBER_FORMATS = {
  CURRENCY: {
    style: 'currency',
    currency: 'USD',
  },
  PERCENTAGE: {
    style: 'percent',
    minimumFractionDigits: 2,
  },
  DECIMAL: {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  },
} as const;
