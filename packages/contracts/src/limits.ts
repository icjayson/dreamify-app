export const RESOURCE_LIMITS = {
  maxAssets: 3,
  maxFileBytes: 10 * 1024 * 1024,
  maxAggregateFileBytes: 25 * 1024 * 1024,
  maxOwnerStorageBytes: 100 * 1024 * 1024,
  maxRowsPerFile: 100_000,
  maxColumnsPerFile: 200,
  maxPromptCharacters: 8_000,
  maxContextMessages: 20,
  maxContextBytes: 64 * 1024,
  maxProfileBytes: 256 * 1024,
  maxAnalysisCodeCharacters: 12 * 1024,
  maxAnalysisResultBytes: 512 * 1024,
  maxDashboardBytes: 1024 * 1024,
  maxDatabaseBytes: 350 * 1024 * 1024,
  maxEventsPerRun: 100,
  maxEventBytes: 32 * 1024,
  maxCharts: 8,
  maxMetrics: 8,
  maxTables: 2,
  maxSeriesPerChart: 6,
  maxPointsPerSeries: 500,
  maxTableRows: 100,
  maxSandboxCommands: 3,
  maxProviderCalls: 5,
  providerAttemptTimeoutMs: 90_000,
  sandboxCommandTimeoutMs: 120_000,
  // Keep a ten-second margin below the 240-second application step ceiling.
  workflowStepTimeoutMs: 230_000,
  workflowDeadlineMs: 20 * 60_000,
  sandboxLifetimeMs: 25 * 60_000,
  sandboxCapacityWaitMs: 10 * 60_000,
  globalSandboxSlots: 2,
} as const;

export type ResourceLimits = typeof RESOURCE_LIMITS;

export const SUPPORTED_ASSET_FORMATS = ["csv", "xlsx", "xls", "json"] as const;
export type SupportedAssetFormat = (typeof SUPPORTED_ASSET_FORMATS)[number];
