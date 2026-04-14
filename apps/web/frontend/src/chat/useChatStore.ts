import { create } from 'zustand';
import { Message } from '@/types/message';
import { conversationNodesToMessages } from '@/chat/conversationToMessages';
import { processingService } from '@/services/processingService';
import { ConversationChatRequest } from '@/services/conversationService';
import type { AssetRecord } from '@/services/fileService';
import { BUILTIN_TEMPLATES } from '@/constants/builtinTemplates';

// ---------------------------------------------------------------------------
// Per-dashboard template persistence
// Each dashboard's template ID is stored in a map so it survives page refresh.
// ---------------------------------------------------------------------------
const DASHBOARD_TEMPLATE_MAP_KEY = 'dreamify_dashboard_template_map';

type SelectedTemplate = { id: string; title: string; description: string; image?: string; category: string; suggestedTheme?: string };

function getDashboardTemplateMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DASHBOARD_TEMPLATE_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveDashboardTemplateId(dashboardId: string, templateId: string): void {
  try {
    const map = getDashboardTemplateMap();
    map[dashboardId] = templateId;
    localStorage.setItem(DASHBOARD_TEMPLATE_MAP_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

function getTemplateIdForDashboard(dashboardId: string): string | null {
  try {
    return getDashboardTemplateMap()[dashboardId] ?? null;
  } catch { return null; }
}

/** Resolve a stored template ID back to the full template object using the canonical list. */
function resolveTemplate(templateId: string | null): SelectedTemplate | null {
  if (!templateId) return null;
  const found = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
  if (!found) return null;
  return {
    id: found.id,
    title: found.name,
    description: found.description,
    category: found.category,
    suggestedTheme: found.suggested_theme,
  };
}


export interface UploadedFile {
  fileID: string;
  filename: string;
  size: number;
  ext: string;
  status: 'uploading' | 'uploaded' | 'processing' | 'processed' | 'error' | 'accepted';
  projectId?: string;
  conversationId?: string;
  processedData?: any;
  rowCount?: number;
  columnCount?: number;
  /** True if file was selected from @mention dropdown (already exists in conversation) */
  isFromMention?: boolean;
  /** Integration source type if the file came from an API sync */
  sourceType?: string;
  /** GA4 account display name */
  accountName?: string;
  /** GA4 property display name */
  propertyName?: string;
  /** True when user chose to keep a header-only / zero-row integration export (not sufficient for analysis) */
  schemaOnly?: boolean;
}

/** Result of Meta Ads sync API (used by Meta modal for empty-data hybrid flow) */
export interface MetaAdsSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: AssetRecord;
  message?: string;
}

/** Result of TikTok Ads sync API */
export interface TikTokAdsSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: AssetRecord;
  message?: string;
}

/** Files that must not trigger analysis-only flows. */
export function isNonAnalyzableUpload(file: UploadedFile): boolean {
  if (file.schemaOnly) return true;
  if (file.rowCount === 0 && (file.sourceType === 'Meta Ads' || file.sourceType === 'TikTok Ads')) return true;
  return false;
}

interface ChatState {
  // Input state
  inputValue: string;
  isTyping: boolean;

  // Messages state
  messages: Message[];

  // File state
  uploadedFiles: UploadedFile[];
  currentConversationId: string | null;
  currentProjectId: string | null;

  // Processing state
  isProcessing: boolean;
  currentWorkflowStep: string | null;
  priorWorkflowSteps: string[];

  // UI state
  dropdownOpen: boolean;
  selectedDataSource: string;

  // Speech recognition state
  isListening: boolean;
  transcript: string;
  detectedLanguage: string | null;

  // Theme state
  dashboardTheme: 'light' | 'dark';
  isThemeChanging: boolean;
  hasShownInitialDashboard: boolean;
  isInitialLoading: boolean;

  // Layout state
  isDashboardOpen: boolean;

  // Dashboard update feedback state
  isUpdatingDashboard: boolean;
  previousDashboardData: any | null;
  changedComponentIds: Set<string>;
  dashboardThumbnails: Record<string, string>;

  // Dashboard selection state
  selectedDashboardId: string | null;

  // Original file for exports
  originalFileBlob?: Blob | null;
  originalFileName?: string | null;

  // Template state
  selectedTemplate: { id: string; title: string; description: string; image?: string; category: string; suggestedTheme?: string } | null;
  /** True only when the user explicitly chose a template before submitting. False when template is restored from a saved dashboard. */
  isTemplatePending: boolean;

  // Abort controller for stopping generation
  abortController: AbortController | null;

  // Integration states
  isGoogleSheetsModalOpen: boolean;
  isGA4ModalOpen: boolean;
  isMetaAdsModalOpen: boolean;
  isTikTokModalOpen: boolean;
  isAppsFlyerModalOpen: boolean;
  isStripeModalOpen: boolean;
  isGoogleAdsModalOpen: boolean;
  isFirebaseModalOpen: boolean;
  googleSheetsFileId: string | null;
  googleSheetsFileName: string | null;

  // Pending action state for cross-page navigation
  pendingAction: PendingAction | null;

  // Selected model state
  selectedModel: 'pro' | 'fast';

  // Actions
  setInputValue: (value: string) => void;
  setIsTyping: (typing: boolean) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  addFiles: (files: UploadedFile[]) => void;
  removeFile: (fileId: string) => void;
  clearFiles: () => void;
  updateFile: (fileId: string, updates: Partial<UploadedFile>) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setDropdownOpen: (open: boolean) => void;
  setSelectedDataSource: (source: string) => void;
  setIsListening: (listening: boolean) => void;
  setTranscript: (transcript: string) => void;
  setDetectedLanguage: (language: string | null) => void;
  setIsProcessing: (processing: boolean) => void;
  setCurrentWorkflowStep: (step: string | null) => void;
  setPriorWorkflowSteps: (steps: string[]) => void;
  updateMessages: (updater: (prev: Message[]) => Message[]) => void;
  setDashboardTheme: (theme: 'light' | 'dark') => void;
  setIsThemeChanging: (changing: boolean) => void;
  setHasShownInitialDashboard: (flag: boolean) => void;
  setIsInitialLoading: (flag: boolean) => void;
  setIsDashboardOpen: (open: boolean) => void;
  setIsUpdatingDashboard: (updating: boolean) => void;
  setPreviousDashboardData: (data: any | null) => void;
  setChangedComponentIds: (ids: Set<string>) => void;
  setDashboardThumbnail: (dashboardId: string, thumbnailUrl: string) => void;
  setSelectedDashboardId: (dashboardId: string | null) => void;
  setOriginalFile: (file: { blob: Blob; name: string } | null) => void;
  setSelectedTemplate: (template: { id: string; title: string; description: string; image?: string; category: string; suggestedTheme?: string } | null) => void;
  setCurrentProjectId: (id: string | null) => void;
  setPendingAction: (action: PendingAction | null) => void;
  setSelectedModel: (model: 'pro' | 'fast') => void;

  // Integration setters
  setGoogleSheetsModalOpen: (open: boolean) => void;
  setGA4ModalOpen: (open: boolean) => void;
  setMetaAdsModalOpen: (open: boolean) => void;
  setTikTokModalOpen: (open: boolean) => void;
  setAppsFlyerModalOpen: (open: boolean) => void;
  setStripeModalOpen: (open: boolean) => void;
  setGoogleAdsModalOpen: (open: boolean) => void;
  setFirebaseModalOpen: (open: boolean) => void;
  setGoogleSheetsFileId: (id: string | null) => void;
  setGoogleSheetsFileName: (name: string | null) => void;

  // Complex actions
  sendMessage: (content: string) => void;
  clearInput: () => void;
  resetChat: () => void;
  processFileWithMessage: (content: string, onProcessedDataChange?: (data: any) => void, projectId?: string, mentionedAssetIds?: string[], activeFileAttachment?: { kind: 'csv' | 'file'; name: string; sourceType?: string; accountName?: string; propertyName?: string }, mentionedCharts?: Array<{ id: string; componentId: string; title: string; type: string; config?: any }>, model?: 'pro' | 'fast', onAccepted?: () => void) => Promise<void>;
  stopGeneration: () => Promise<void>;
  resumeWorkflowPolling: (projectId: string, conversationId: string, onProcessedDataChange?: (data: any) => void) => Promise<void>;
  selectDashboard: (dashboardId: string, projectId: string) => Promise<any>;

  // Sync actions
  syncGoogleSheets: (projectId?: string, oauthToken?: string) => Promise<void>;
  syncGA4: (propertyId: string, projectId?: string, startDate?: string, endDate?: string, accountName?: string, propertyName?: string) => Promise<void>;
  syncMetaAds: (adAccountId: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string, accountName?: string, adsetIds?: string[], campaignIds?: string[]) => Promise<MetaAdsSyncResult>;
  syncAppsFlyer: (appId: string, appName: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string) => Promise<AppsFlyerSyncResult>;
  syncStripe: (reportType: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string) => Promise<StripeSyncResult>;
  syncGoogleAds: (adAccountId: string, projectId?: string, startDate?: string, endDate?: string, accountName?: string) => Promise<StripeSyncResult>;
  syncFirebase: (firebaseProjectId: string, projectName: string, projectId?: string, startDate?: string, endDate?: string) => Promise<StripeSyncResult>;
}

/** Result of AppsFlyer sync API */
export interface AppsFlyerSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
}

/** Result of Stripe sync API */
export interface StripeSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
}

export interface PendingAction {
  type: 'process_file';
  content: string;
  files: UploadedFile[];
  projectId: string;
  model?: 'pro' | 'fast';
}

// Ordered sequence of workflow steps (used to reconstruct prior steps on resume)
const STEP_ORDER = ['start', 'load_conversation', 'download_asset', 'run_workflow', 'routing', 'reasoning', 'execution', 'synthesis', 'validation', 'finish'];

const initialMessages: Message[] = [
  {
    id: "1",
    role: "assistant",
    content: "Hi! I'm Dreamify, your analytics intern. Upload data, visualise motion-rich dashboard in seconds!",
    timestamp: new Date()
  }
];

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  inputValue: "",
  isTyping: false,
  messages: initialMessages,
  uploadedFiles: [],
  currentConversationId: null,
  currentProjectId: null,
  isProcessing: false,
  currentWorkflowStep: null,
  priorWorkflowSteps: [],
  dropdownOpen: false,
  selectedDataSource: "",
  isListening: false,
  transcript: "",
  detectedLanguage: null,
  dashboardTheme: 'light',
  isThemeChanging: false,
  hasShownInitialDashboard: false,
  isInitialLoading: false,
  isDashboardOpen: false,
  isUpdatingDashboard: false,
  previousDashboardData: null,
  changedComponentIds: new Set<string>(),
  dashboardThumbnails: {},
  selectedDashboardId: null,
  originalFileBlob: null,
  originalFileName: null,
  selectedTemplate: (() => { try { const s = localStorage.getItem('dreamify_selected_template'); return s ? JSON.parse(s) : null; } catch { return null; } })(),
  isTemplatePending: (() => { try { return !!localStorage.getItem('dreamify_selected_template'); } catch { return false; } })(),
  abortController: null,
  pendingAction: null,
  isGoogleSheetsModalOpen: false,
  isGA4ModalOpen: false,
  isMetaAdsModalOpen: false,
  isTikTokModalOpen: false,
  isAppsFlyerModalOpen: false,
  isStripeModalOpen: false,
  isGoogleAdsModalOpen: false,
  isFirebaseModalOpen: false,
  googleSheetsFileId: null,
  googleSheetsFileName: null,
  selectedModel: 'pro',

  // Basic setters
  setInputValue: (value) => set({ inputValue: value }),
  setIsTyping: (typing) => set({ isTyping: typing }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  addFiles: (files) => set((state) => {
    const currentLength = state.uploadedFiles.length;
    const newLength = currentLength + files.length;
    if (newLength > 5) {
      console.warn('Maximum 5 files allowed');
      return state;
    }
    const existingIds = new Set(state.uploadedFiles.map(f => f.fileID));
    const uniqueFiles = files.filter(f => !existingIds.has(f.fileID));
    return {
      uploadedFiles: [...state.uploadedFiles, ...uniqueFiles]
    };
  }),
  removeFile: (fileId) => set((state) => ({
    uploadedFiles: state.uploadedFiles.filter(f => f.fileID !== fileId)
  })),
  clearFiles: () => set({ uploadedFiles: [] }),
  updateFile: (fileId, updates) => set((state) => ({
    uploadedFiles: state.uploadedFiles.map(f => f.fileID === fileId ? { ...f, ...updates } : f)
  })),
  setCurrentConversationId: (conversationId) => set({ currentConversationId: conversationId }),
  setDropdownOpen: (open) => set({ dropdownOpen: open }),
  setSelectedDataSource: (source) => set({ selectedDataSource: source }),
  setIsListening: (listening) => set({ isListening: listening }),
  setTranscript: (transcript) => set({ transcript }),
  setDetectedLanguage: (language) => set({ detectedLanguage: language }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setCurrentWorkflowStep: (step) => set({ currentWorkflowStep: step }),
  setPriorWorkflowSteps: (steps) => set({ priorWorkflowSteps: steps }),
  updateMessages: (updater) => set((state) => ({ messages: updater(state.messages) })),
  setDashboardTheme: (theme) => set({ dashboardTheme: theme }),
  setIsThemeChanging: (changing) => set({ isThemeChanging: changing }),
  setHasShownInitialDashboard: (flag) => set({ hasShownInitialDashboard: flag }),
  setIsInitialLoading: (flag) => set({ isInitialLoading: flag }),
  setIsDashboardOpen: (open) => set({ isDashboardOpen: open }),
  setIsUpdatingDashboard: (updating) => set({ isUpdatingDashboard: updating }),
  setPreviousDashboardData: (data) => set({ previousDashboardData: data }),
  setChangedComponentIds: (ids) => set({ changedComponentIds: ids }),
  setDashboardThumbnail: (dashboardId, thumbnailUrl) => set((state) => ({
    dashboardThumbnails: { ...state.dashboardThumbnails, [dashboardId]: thumbnailUrl }
  })),
  setSelectedDashboardId: (dashboardId) => {
    const restoredTemplate = dashboardId ? resolveTemplate(getTemplateIdForDashboard(dashboardId)) : null;
    set({ selectedDashboardId: dashboardId, selectedTemplate: restoredTemplate });
  },
  setOriginalFile: (file) => set({ originalFileBlob: file?.blob ?? null, originalFileName: file?.name ?? null }),
  setSelectedTemplate: (template) => {
    try {
      if (template) localStorage.setItem('dreamify_selected_template', JSON.stringify(template));
      else localStorage.removeItem('dreamify_selected_template');
    } catch { /* ignore */ }
    set({ selectedTemplate: template, isTemplatePending: !!template });
  },
  setPendingAction: (action) => set({ pendingAction: action }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setGoogleSheetsModalOpen: (open) => set({ isGoogleSheetsModalOpen: open }),
  setGA4ModalOpen: (open) => set({ isGA4ModalOpen: open }),
  setMetaAdsModalOpen: (open) => set({ isMetaAdsModalOpen: open }),
  setTikTokModalOpen: (open) => set({ isTikTokModalOpen: open }),
  setAppsFlyerModalOpen: (open) => set({ isAppsFlyerModalOpen: open }),
  setStripeModalOpen: (open) => set({ isStripeModalOpen: open }),
  setGoogleAdsModalOpen: (open) => set({ isGoogleAdsModalOpen: open }),
  setFirebaseModalOpen: (open) => set({ isFirebaseModalOpen: open }),
  setGoogleSheetsFileId: (id) => {
    console.log('Store: setting googleSheetsFileId:', id);
    set({ googleSheetsFileId: id });
  },
  setGoogleSheetsFileName: (name) => {
    console.log('Store: setting googleSheetsFileName:', name);
    set({ googleSheetsFileName: name });
  },
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  // Sync actions implementation
  syncGoogleSheets: async (projectId, oauthToken) => {
    const { googleSheetsFileId, googleSheetsFileName, addFiles, setGoogleSheetsFileId, setGoogleSheetsFileName, setGoogleSheetsModalOpen } = get();
    if (!googleSheetsFileId) return;

    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleSheetData(googleSheetsFileId, projectId, oauthToken);

      if (response.success && response.asset) {
        const newFile = {
          fileID: response.asset.asset_id,
          filename: response.asset.filename,
          size: response.asset.size_bytes || 0,
          ext: response.asset.extension || 'csv',
          status: 'uploaded' as const,
          projectId: response.asset.project_id || undefined,
          sourceType: 'Google Sheets',
          accountName: 'Google Sheets',
          propertyName: googleSheetsFileName || response.asset.filename,
          rowCount: response.asset.row_count,
          columnCount: response.asset.column_count,
        };

        addFiles([newFile]);
        setGoogleSheetsFileId(null);
        setGoogleSheetsFileName(null);
        setGoogleSheetsModalOpen(false);
      } else {
        throw new Error(response.error || 'Failed to sync Google Sheets');
      }
    } catch (err) {
      console.error('Sync Google Sheets error:', err);
      throw err;
    }
  },

  syncGA4: async (propertyId, projectId, startDate, endDate, accountName, propertyName) => {
    const { addFiles, setGA4ModalOpen } = get();
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleAnalyticsData(
        propertyId,
        projectId,
        startDate || '30daysAgo',
        endDate || 'today',
        accountName || 'GA4',
        propertyName || 'GA4',
      );

      if (response.success && response.asset) {
        const newFile = {
          fileID: response.asset.asset_id,
          filename: response.asset.filename,
          size: response.asset.size_bytes || 0,
          ext: response.asset.extension || 'csv',
          status: 'uploaded' as const,
          projectId: response.asset.project_id || undefined,
          sourceType: 'GA4',
          accountName: accountName || (response.asset as any).accountName || 'GA4',
          propertyName: propertyName || (response.asset as any).propertyName || response.asset.filename,
        };
        addFiles([newFile]);
        setGA4ModalOpen(false);
      } else {
        throw new Error(response.error || 'Failed to sync GA4');
      }
    } catch (err) {
      console.error('Sync GA4 error:', err);
      throw err;
    }
  },

  syncMetaAds: async (adAccountId, projectId, datePreset, startDate, endDate, accountName, adsetIds, campaignIds) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncMetaAdsData(
        adAccountId,
        projectId,
        datePreset || 'last_30d',
        startDate,
        endDate,
        accountName || 'Meta Ads',
        adsetIds,
        campaignIds
      );

      if (response.success && response.asset) {
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Meta Ads');
    } catch (err) {
      console.error('Sync Meta Ads error:', err);
      throw err;
    }
  },

  syncTikTokAds: async (adAccountId, projectId, datePreset, startDate, endDate, accountName) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncTikTokAdsData(
        adAccountId,
        projectId,
        datePreset || 'last_30d',
        startDate,
        endDate,
        accountName || 'TikTok Ads',
      );

      if (response.success && response.asset) {
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync TikTok Ads');
    } catch (err) {
      console.error('Sync TikTok Ads error:', err);
      throw err;
    }
  },

  syncAppsFlyer: async (appId, appName, projectId, datePreset, startDate, endDate) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncAppsFlyer({
        app_id: appId,
        app_name: appName,
        ...(projectId && { project_id: projectId }),
        date_preset: datePreset || 'last_30d',
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
      });

      if (response.success && response.asset) {
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync AppsFlyer');
    } catch (err) {
      console.error('Sync AppsFlyer error:', err);
      throw err;
    }
  },

  syncStripe: async (reportType, projectId, datePreset, startDate, endDate) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncStripe({
        report_type: reportType,
        ...(projectId && { project_id: projectId }),
        date_preset: datePreset || 'last_30d',
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
      });

      if (response.success && response.asset) {
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Stripe');
    } catch (err) {
      console.error('Sync Stripe error:', err);
      throw err;
    }
  },

  syncGoogleAds: async (adAccountId, projectId, startDate, endDate, accountName) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleAdsData({
        ad_account_id: adAccountId,
        ...(projectId && { project_id: projectId }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        ...(accountName && { account_name: accountName }),
      });

      if (response.success && response.asset) {
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Google Ads');
    } catch (err) {
      console.error('Sync Google Ads error:', err);
      throw err;
    }
  },

  syncFirebase: async (firebaseProjectId, projectName, projectId, startDate, endDate) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncFirebaseData({
        firebase_project_id: firebaseProjectId,
        app_name: projectName,
        ...(projectId && { project_id: projectId }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
      });

      if (response.success && response.asset) {
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Firebase data');
    } catch (err) {
      console.error('Sync Firebase error:', err);
      throw err;
    }
  },

  // Complex actions
  sendMessage: (content) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
      attachment: get().uploadedFiles.length > 0 ? {
        kind: "csv",
        name: get().uploadedFiles.length === 1
          ? get().uploadedFiles[0].filename
          : `${get().uploadedFiles.length} files`,
        sourceType: get().uploadedFiles[0].sourceType,
        accountName: get().uploadedFiles[0].accountName,
        propertyName: get().uploadedFiles[0].propertyName,
      } : undefined,
      template: get().selectedTemplate || undefined,
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      inputValue: ""
    }));
  },

  clearInput: () => set({ inputValue: "" }),

  processFileWithMessage: async (content: string, onProcessedDataChange?: (data: any) => void, projectIdParam?: string, mentionedAssetIds?: string[], activeFileAttachment?: { kind: 'csv' | 'file'; name: string; sourceType?: string; accountName?: string; propertyName?: string }, mentionedCharts?: Array<{ id: string; componentId: string; title: string; type: string; config?: any }>, model?: 'pro' | 'fast', onAccepted?: () => void) => {
    const state = get();
    const { uploadedFiles, updateFile, setIsProcessing, setIsTyping, addMessage, updateMessages, messages, setDashboardTheme, setIsThemeChanging, hasShownInitialDashboard, dashboardTheme, currentConversationId, setCurrentConversationId, setCurrentWorkflowStep } = state;

    // Create new AbortController for this processing session
    const abortController = new AbortController();
    set({ abortController, currentProjectId: projectIdParam || null });

    // Clear current workflow step at start
    setCurrentWorkflowStep(null);

    // Text-only message path: allow theme change after initial dashboard shown, only if currently light
    // @mentioned files should use Q&A path (they're already in conversation)
    const hasUploadedFiles = uploadedFiles.some(f => f.status === 'uploaded' && !f.isFromMention);

    // Clear uploaded files immediately so they disappear from the input chips area 
    // once the message start process is initiated.
    get().clearFiles();

    const isTextOnly = !hasUploadedFiles;

    if (isTextOnly) {
      // No file uploaded - process Q&A (with or without existing conversation)
      console.log('No file - processing Q&A', { hasConversation: !!currentConversationId, projectId: projectIdParam });

      // Check if we have projectId (required for API call)
      if (!projectIdParam) {
        console.log('No projectId - cannot process Q&A');
        const userMessage: Message = {
          id: Date.now().toString(),
          role: "user",
          content: content.trim(),
          timestamp: new Date(),
          template: get().selectedTemplate || undefined,
        };
        addMessage(userMessage);

        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Project context is required. Please ensure you are in a project workspace.",
          timestamp: new Date(),
        };
        addMessage(errorMessage);
        return;
      }

      // Process Q&A (with or without existing conversation)
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== content.trim()) {
        const userMessage: Message = {
          id: Date.now().toString(),
          role: "user",
          content: content.trim(),
          timestamp: new Date(),
          attachment: activeFileAttachment || (uploadedFiles.length > 0 ? {
            kind: "csv",
            name: uploadedFiles.length === 1 ? uploadedFiles[0].filename : `${uploadedFiles.length} files`,
            sourceType: uploadedFiles.length === 1 ? uploadedFiles[0].sourceType : 'Multiple',
            accountName: uploadedFiles.length === 1 ? uploadedFiles[0].accountName : undefined,
            propertyName: uploadedFiles.length === 1 ? uploadedFiles[0].propertyName : undefined,
          } : undefined),
          chartMentions: mentionedCharts && mentionedCharts.length > 0
            ? mentionedCharts.map(c => ({ title: c.title, type: c.type, componentId: c.componentId || c.id }))
            : undefined,
          template: get().selectedTemplate || undefined,
        };
        addMessage(userMessage);
      }

      setIsTyping(true);
      setIsProcessing(true);

      // If dashboard is already open, mark as updating for edit feedback loop
      if (get().isDashboardOpen) {
        set({ isUpdatingDashboard: true });
      }

      // Update file status to processing to show loading indicator in chip
      // Skip files already 'processed' from previous conversation (restored on reload)
      uploadedFiles.filter(f => f.status !== 'processed').forEach(f => updateFile(f.fileID, { status: 'processing' }));

      try {
        // Use projectId from parameter (required)
        const projectId = projectIdParam;

        if (!projectId) {
          throw new Error('Project context missing. Please ensure you are in a project workspace.');
        }

        // Only attach asset content if this is a NEW file upload, not an @mention of existing file
        const freshUploads = uploadedFiles.filter(f =>
          f.fileID && !f.isFromMention && !f.conversationId && f.status === 'uploaded'
        );

        let assetContents: ConversationChatRequest['user_node_contents'] = undefined;
        let assetId: string | null = freshUploads[0]?.fileID ?? null;

        const assetContentsList: ConversationChatRequest['user_node_contents'] = [];
        for (const file of freshUploads) {
          try {
            const { fileService } = await import('@/services/fileService');
            const assetResponse = await fileService.getAsset(file.fileID);
            if (assetResponse.success && assetResponse.asset) {
              const assetData = assetResponse.asset;
              assetContentsList.push({
                type: 'asset',
                data: {
                  asset_id: assetData.asset_id,
                  file_id: assetData.file_id,
                  s3_bucket: assetData.s3_bucket,
                  s3_key: assetData.s3_key,
                  extension: assetData.extension,
                  filename: assetData.filename,
                  sourceType: assetData?.asset_type || '',
                }
              });
            }
          } catch (error) {
            console.warn('Failed to fetch asset data for QnA:', error);
          }
        }

        // Add @mentioned files as 'mention' content entries so badge persists in conversation JSON
        // Uses 'mention' type so backend doesn't treat them as new assets to process
        if (mentionedAssetIds && mentionedAssetIds.length > 0) {
          for (const mentionedId of mentionedAssetIds) {
            if (assetContentsList.some(c => c.data?.asset_id === mentionedId)) continue;
            const mentionedFile = uploadedFiles.find(f => f.fileID === mentionedId);
            if (mentionedFile) {
              assetContentsList.push({
                type: 'mention',
                data: {
                  asset_id: mentionedId,
                  filename: mentionedFile.filename,
                  kind: mentionedFile.ext === 'csv' ? 'csv' : 'file',
                  sourceType: mentionedFile?.sourceType || '',
                }
              });
            }
          }
        }

        if (assetContentsList.length === 0 && activeFileAttachment) {
          assetContentsList.push({
            type: 'mention',
            data: {
              asset_id: 'all-assets', // Dummy ID for persistence
              filename: activeFileAttachment.name,
              kind: activeFileAttachment.kind,
            }
          });
        }

        // Add chart mention entries
        if (mentionedCharts && mentionedCharts.length > 0) {
          for (const chart of mentionedCharts) {
            assetContentsList.push({
              type: 'chart_mention',
              data: {
                component_id: chart.componentId,
                chart_id: chart.id,
                title: chart.title,
                chart_type: chart.type,
                config: chart.config,
              }
            });
          }
        }

        if (assetContentsList.length > 0) {
          assetContents = assetContentsList;
        }

        // Exclude restored files (already processed from previous conversation)
        const allFileIds = uploadedFiles.filter(f => !(f.status === 'processed' && f.conversationId)).map(f => f.fileID).filter(Boolean);
        const userNodeMetadata = mentionedAssetIds && mentionedAssetIds.length > 0
          ? { asset_selection: 'explicit' as const, selected_asset_ids: mentionedAssetIds, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) }
          : allFileIds.length > 0
            ? { asset_selection: 'explicit' as const, selected_asset_ids: allFileIds, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) }
            : { asset_selection: 'all' as const, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) };

        // Call processing service with file attachment if available
        const startResult = await processingService.runProcessing(
          projectId,
          assetId,
          content,
          currentConversationId || undefined,  // Use existing conversation if available
          assetContents,
          userNodeMetadata,
          model,
          get().selectedTemplate?.id
        );

        console.log('Q&A processing result:', startResult);

        if (startResult.data?.success && (startResult.data?.status === 'processing' || startResult.data?.status === 'accepted')) {
          // Invoke onAccepted callback to allow early UI updates (e.g. credit refresh)
          if (onAccepted) onAccepted();

          const conversationId = startResult.data?.conversation_id || currentConversationId;
          if (conversationId) {
            setCurrentConversationId(conversationId);
          }

          // Poll for completion
          const finalResult = await processingService.pollProcessingStatus(
            '',  // No assetId for Q&A
            projectId,
            conversationId,
            (status) => {
              // Update status based on workflow status
              const workflowStatus = status.data?.workflow_status?.status;

              // For QnA: DON'T update uploadedFile status to 'processing'
              // This prevents ProjectPage from showing "Generating Dashboard"
              // Keep status as 'uploaded' until QnA completes
              if (workflowStatus === 'error') {
                uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
              }

              if (workflowStatus === 'error' || workflowStatus === 'stopped') {
                setIsProcessing(false);
              }
              if (workflowStatus === 'stopped') {
                setIsTyping(false);
              }
              // Track current workflow step
              const step = status.data?.workflow_status?.metadata?.step;
              if (step) {
                setCurrentWorkflowStep(step);
              }
            },
            360,
            5000,
            abortController.signal
          );

          console.log('Q&A final result:', finalResult);

          if (finalResult.data?.success && finalResult.data?.status === 'completed') {
            // Q&A response - check if it's a message or dashboard
            if (finalResult.data?.dashboard_data) {
              // Dashboard response - load conversation to get LLM's actual response text
              try {
                const { conversationService } = await import('@/services/conversationService');
                const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
                const conversation = conversationResponse.conversation;

                // Extract dashboard_id from conversation
                const dashboards = conversation.dashboards || [];
                const latestDashboard = dashboards[dashboards.length - 1];
                const dashboardId = latestDashboard?.dashboard_id || "";

                // Set the latest dashboard as selected and update processedData
                if (dashboardId) {
                  set({ selectedDashboardId: dashboardId, isDashboardOpen: true });
                  // Persist template association for this dashboard
                  const currentTemplate = get().selectedTemplate;
                  if (currentTemplate?.id) {
                    saveDashboardTemplateId(dashboardId, currentTemplate.id);
                  }
                  // Update processedData with the new dashboard data (first file for display)
                  const firstFile = get().uploadedFiles[0];
                  if (firstFile) {
                    updateFile(firstFile.fileID, { status: 'processed', processedData: finalResult.data.dashboard_data });
                  }

                  // Signal completion to UI for automatic rendering (unconditional)
                  if (onProcessedDataChange) {
                    onProcessedDataChange(finalResult.data.dashboard_data);
                  }

                  // Auto-capture PNG preview (fire-and-forget, non-blocking)
                  const _captureProjectId = projectId;
                  const _captureDashboardId = dashboardId;
                  setTimeout(async () => {
                    try {
                      const { captureDashboardAsWebpBlob } = await import('@/utils/exportUtils');
                      const blob = await captureDashboardAsWebpBlob('dashboard-preview-root');
                      if (blob && _captureProjectId && _captureDashboardId) {
                        const { projectService } = await import('@/services/projectService');
                        await projectService.uploadDashboardPreview(_captureProjectId, _captureDashboardId, blob);
                        console.log('Dashboard preview captured and uploaded for project', _captureProjectId);
                      }
                    } catch (e) {
                      console.warn('Dashboard preview capture failed (non-critical):', e);
                    }
                  }, 4000);
                }

                const firstFile = get().uploadedFiles[0];
                const restoredMessages = conversationNodesToMessages(conversation, {
                  sourceFileName: firstFile?.filename || 'dashboard',
                  lastUserMessageAttachment: firstFile ? {
                    kind: 'csv',
                    name: firstFile.filename,
                    mime: 'text/csv',
                    sourceType: firstFile.sourceType,
                    accountName: firstFile.accountName,
                    propertyName: firstFile.propertyName
                  } : undefined
                });
                if (restoredMessages.length) {
                  const lastRestored = restoredMessages[restoredMessages.length - 1];

                  // Case 1: Last message is assistant with dashboardCard but empty content
                  if (lastRestored?.role === 'assistant' && lastRestored.dashboardCard && !lastRestored.content) {
                    const prevUserMsg = [...restoredMessages].reverse().find(m => m.role === 'user' && m.chartMentions?.length);
                    if (prevUserMsg?.chartMentions?.length) {
                      const chartNames = prevUserMsg.chartMentions.map(c => c.title).filter(Boolean).join(', ');
                      lastRestored.content = `Done! I've updated ${chartNames || 'the chart'}. The dashboard has been refreshed with your changes.`;
                    } else {
                      lastRestored.content = 'Your dashboard has been updated with the requested changes.';
                    }
                  }

                  // Case 2: Last message is a user message — backend's assistant node was filtered out
                  // (no text, no dashboard content). Synthesize a response.
                  if (lastRestored?.role === 'user') {
                    const chartMentions = lastRestored.chartMentions;
                    let responseContent = 'Your dashboard has been updated with the requested changes.';
                    if (chartMentions?.length) {
                      const chartNames = chartMentions.map(c => c.title).filter(Boolean).join(', ');
                      responseContent = `Done! I've updated ${chartNames || 'the chart'}. The dashboard has been refreshed with your changes.`;
                    }
                    restoredMessages.push({
                      id: (Date.now() + 1).toString(),
                      role: 'assistant',
                      content: responseContent,
                      dashboardCard: {
                        sourceFileName: get().uploadedFiles[0]?.filename || 'dashboard',
                        dashboardId: dashboardId,
                        dashboardTitle: latestDashboard?.title || undefined,
                        accountName: get().uploadedFiles[0]?.accountName,
                        sourceType: get().uploadedFiles[0]?.sourceType,
                      },
                      timestamp: new Date(),
                    });
                  }

                  get().setMessages(restoredMessages);
                }
              } catch (error) {
                console.error('Failed to load conversation for dashboard response:', error);
                // No fallback message
                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 2).toString(),
                    role: 'assistant',
                    content: "",
                    dashboardCard: {
                      sourceFileName: get().uploadedFiles[0]?.filename || "dashboard",
                      dashboardId: "",
                      accountName: get().uploadedFiles[0]?.accountName,
                      sourceType: get().uploadedFiles[0]?.sourceType,
                    },
                    timestamp: new Date(),
                  }
                ]));
              }
            } else {
              // Q&A text response - load conversation and show all nodes in workflow order
              try {
                const { conversationService } = await import('@/services/conversationService');
                const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
                const conversation = conversationResponse.conversation;
                const restoredMessages = conversationNodesToMessages(conversation);
                if (restoredMessages.length) {
                  get().setMessages(restoredMessages);

                  // Auto-open dashboard if the latest message includes a dashboard card
                  const lastMsg = restoredMessages[restoredMessages.length - 1];
                  const dashId = lastMsg?.dashboardCard?.dashboardId;
                  if (dashId) {
                    set({
                      isDashboardOpen: true,
                      hasShownInitialDashboard: true,
                      isInitialLoading: false,
                    });
                    get().selectDashboard(dashId, projectId).then((data) => {
                      if (data && onProcessedDataChange) {
                        onProcessedDataChange(data);
                      }
                    });
                  }
                }
                // Update file status to processed to hide chip
                get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'processed' }));
              } catch (error) {
                console.error('Failed to load conversation for Q&A response:', error);
                // Fallback to workflow status metadata
                const workflowStatus = finalResult.data?.workflow_status;
                const responseText = workflowStatus?.metadata?.content ||
                  workflowStatus?.message ||
                  "I've processed your question.";

                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: responseText,
                    timestamp: new Date(),
                  }
                ]));
              }
            }
          } else if (finalResult.data?.status === 'error') {
            const errorMsg = finalResult.data?.error || 'An error occurred while processing your question.';
            uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          }
        } else {
          const errorMsg = startResult.data?.error || 'Failed to start processing.';
          updateMessages((prev) => ([
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: 'Error while generating dashboard',
              timestamp: new Date(),
              isError: true,
            }
          ]));
        }
      } catch (error) {
        console.error('Q&A processing error:', error);
        uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
        const errObj = error as Record<string, unknown>;
        const errDetail = (errObj?.response as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        const isInsufficientCredits =
          errObj?.status === 402 ||
          (errDetail as Record<string, unknown> | undefined)?.error === 'insufficient_credits' ||
          (errObj?.detail as Record<string, unknown> | undefined)?.error === 'insufficient_credits';
        updateMessages((prev) => ([
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Error while generating dashboard',
            timestamp: new Date(),
            isError: true,
            isInsufficientCredits,
          }
        ]));
      } finally {
        setIsTyping(false);
        setIsProcessing(false);
        set({ isUpdatingDashboard: false });
      }
      return;
    }

    // Check if user message with this content already exists
    const firstUploadedFile = uploadedFiles[0];
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== content.trim()) {
      // User message doesn't exist, add it
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
        attachment: activeFileAttachment || (uploadedFiles.length > 0 ? {
          kind: "csv",
          name: uploadedFiles.length === 1 ? firstUploadedFile.filename : `${uploadedFiles.length} files`,
          sourceType: uploadedFiles.length === 1 ? firstUploadedFile.sourceType : 'Multiple',
          accountName: uploadedFiles.length === 1 ? firstUploadedFile.accountName : undefined,
          propertyName: uploadedFiles.length === 1 ? firstUploadedFile.propertyName : undefined,
        } : undefined),
        chartMentions: mentionedCharts && mentionedCharts.length > 0
          ? mentionedCharts.map(c => ({ title: c.title, type: c.type, componentId: c.componentId || c.id }))
          : undefined,
        template: get().selectedTemplate || undefined,
      };
      addMessage(userMessage);
    }

    // Get updated messages after adding user message
    const updatedMessages = get().messages;
    setIsTyping(true);
    setIsProcessing(true);

    try {
      // Start processing with user prompt - set all files to processing
      set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => ({ ...f, status: 'processing' as const })) }));
      const projectId = projectIdParam || firstUploadedFile.projectId;
      if (!projectId) {
        throw new Error('Project context missing for uploaded file');
      }

      console.log('Starting processing for fileIDs:', uploadedFiles.map(f => f.fileID));
      const freshUploadsForProcessing = uploadedFiles.filter(f =>
        f.fileID && !f.isFromMention && !f.conversationId
      );
      const assetContentsList: ConversationChatRequest['user_node_contents'] = [];
      for (const file of freshUploadsForProcessing) {
        try {
          const { fileService } = await import('@/services/fileService');
          const assetResponse = await fileService.getAsset(file.fileID);
          if (assetResponse.success && assetResponse.asset) {
            const assetData = assetResponse.asset;
            assetContentsList.push({
              type: 'asset',
              data: {
                asset_id: assetData.asset_id,
                file_id: assetData.file_id,
                s3_bucket: assetData.s3_bucket,
                s3_key: assetData.s3_key,
                extension: assetData.extension,
                filename: assetData.filename,
                sourceType: assetData?.asset_type || '',
              }
            });
          }
        } catch (error) {
          console.warn('Failed to fetch asset data:', error);
        }
      }

      // Add @mentioned files as 'mention' content entries so badge persists in conversation JSON
      if (mentionedAssetIds && mentionedAssetIds.length > 0) {
        for (const mentionedId of mentionedAssetIds) {
          if (assetContentsList.some(c => c.data?.asset_id === mentionedId)) continue;
          const mentionedFile = uploadedFiles.find(f => f.fileID === mentionedId);
          if (mentionedFile) {
            assetContentsList.push({
              type: 'mention',
              data: {
                asset_id: mentionedId,
                filename: mentionedFile.filename,
                kind: mentionedFile.ext === 'csv' ? 'csv' : 'file',
                sourceType: mentionedFile?.sourceType || '',
              }
            });
          }
        }
      }

      if (assetContentsList.length === 0 && activeFileAttachment) {
        assetContentsList.push({
          type: 'mention',
          data: {
            asset_id: 'all-assets', // Dummy ID for persistence
            filename: activeFileAttachment.name,
            kind: activeFileAttachment.kind,
          }
        });
      }

      // Add chart mention entries (second code path)
      if (mentionedCharts && mentionedCharts.length > 0) {
        for (const chart of mentionedCharts) {
          assetContentsList.push({
            type: 'chart_mention',
            data: {
              component_id: chart.componentId,
              chart_id: chart.id,
              title: chart.title,
              chart_type: chart.type,
              config: chart.config,
            }
          });
        }
      }

      const assetContents = assetContentsList.length > 0 ? assetContentsList : undefined;
      const allFileIdsForMeta = get().uploadedFiles.map(f => f.fileID).filter(Boolean);
      const userNodeMetadata = mentionedAssetIds && mentionedAssetIds.length > 0
        ? { asset_selection: 'explicit' as const, selected_asset_ids: mentionedAssetIds, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) }
        : allFileIdsForMeta.length > 0
          ? { asset_selection: 'explicit' as const, selected_asset_ids: allFileIdsForMeta, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) }
          : { asset_selection: 'all' as const, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) };

      const startResult = await processingService.runProcessing(
        projectId,
        firstUploadedFile.fileID,
        content,
        firstUploadedFile.conversationId || currentConversationId || undefined,
        assetContents,
        userNodeMetadata,
        model
      );
      console.log('Run processing result:', startResult);
      // processing or accepted
      if (startResult.data?.success && (startResult.data?.status === 'processing' || startResult.data?.status === 'accepted')) {
        // Invoke onAccepted callback to allow early UI updates (e.g. credit refresh)
        if (onAccepted) onAccepted();

        const conversationId = startResult.data?.conversation_id;
        if (conversationId) {
          set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => ({ ...f, conversationId })), currentConversationId: conversationId }));
          setCurrentConversationId(conversationId);
        }

        console.log('Processing started, beginning polling...');
        const finalResult = await processingService.pollProcessingStatus(
          firstUploadedFile.fileID,
          projectId,
          conversationId,
          (status) => {
            const workflowStatus = status.data?.workflow_status?.status;
            if (workflowStatus === 'processing') {
              set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => ({ ...f, status: 'processing' as const })) }));
            } else if (workflowStatus === 'error' || workflowStatus === 'stopped') {
              const newStatus = workflowStatus === 'stopped' ? 'processed' : 'error';
              set((s) => ({
                uploadedFiles: s.uploadedFiles.map(f => ({ ...f, status: newStatus }))
              }));
            }
            if (workflowStatus === 'stopped') {
              setIsProcessing(false);
              setIsTyping(false);
            }
            const step = status.data?.workflow_status?.metadata?.step;
            if (step) {
              setCurrentWorkflowStep(step);
            }
          },
          360, // max attempts (30 minutes)
          5000, // 5 second intervals
          abortController.signal
        );
        console.log('Final polling result:', finalResult);

        if (finalResult.data?.success && finalResult.data?.status === 'completed') {
          if (finalResult.data?.dashboard_data) {
            const files = get().uploadedFiles;
            if (files.length > 0) {
              updateFile(files[0].fileID, { status: 'processed', processedData: finalResult.data?.dashboard_data });
            }
            // Load conversation to get LLM's actual response text and dashboard_id
            try {
              const { conversationService } = await import('@/services/conversationService');
              const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
              const conversation = conversationResponse.conversation;

              // Extract dashboard_id from conversation
              const dashboards = conversation.dashboards || [];
              const latestDashboard = dashboards[dashboards.length - 1];
              const dashboardId = latestDashboard?.dashboard_id || "";

              // Set the latest dashboard as selected and update processedData
              if (dashboardId) {
                // Auto open the dashboard FIRST, before signaling data
                set({
                  selectedDashboardId: dashboardId,
                  isDashboardOpen: true,
                  hasShownInitialDashboard: true,
                  isInitialLoading: false,
                });
                const files = get().uploadedFiles;
                if (files.length > 0) {
                  updateFile(files[0].fileID, { processedData: finalResult.data.dashboard_data });
                }
                // Signal completion to UI for automatic rendering
                if (onProcessedDataChange) {
                  onProcessedDataChange(finalResult.data.dashboard_data);
                }

                // Auto-capture PNG preview (fire-and-forget, non-blocking)
                const _captureProjectId2 = projectId;
                const _captureDashboardId2 = dashboardId;
                setTimeout(async () => {
                  try {
                    const { captureDashboardAsWebpBlob } = await import('@/utils/exportUtils');
                    const blob = await captureDashboardAsWebpBlob('dashboard-preview-root');
                    if (blob && _captureProjectId2 && _captureDashboardId2) {
                      const { projectService } = await import('@/services/projectService');
                      await projectService.uploadDashboardPreview(_captureProjectId2, _captureDashboardId2, blob);
                      console.log('Dashboard preview captured and uploaded for project', _captureProjectId2);
                    }
                  } catch (e) {
                    console.warn('Dashboard preview capture failed (non-critical):', e);
                  }
                }, 4000);

                // Persist template association for this dashboard, then clear the transient "pending" key
                const currentTemplate = get().selectedTemplate;
                if (dashboardId && currentTemplate?.id) {
                  saveDashboardTemplateId(dashboardId, currentTemplate.id);
                }
                try { localStorage.removeItem('dreamify_selected_template'); } catch { }
                set({ selectedTemplate: null });
              }

              const currentFiles = get().uploadedFiles;
              const restoredMessages = conversationNodesToMessages(conversation, {
                sourceFileName: currentFiles[0]?.filename ?? 'dashboard',
                lastUserMessageAttachment: currentFiles[0] ? {
                  kind: 'csv',
                  name: currentFiles[0].filename,
                  sourceType: currentFiles[0].sourceType,
                  accountName: currentFiles[0].accountName,
                  propertyName: currentFiles[0].propertyName,
                } : undefined,
              });
              if (restoredMessages.length) {
                get().setMessages(restoredMessages);
              }

              // DON'T clear uploadedFile - ProjectPage needs it to determine dashboard display
              // The FilePreviewChip will be hidden based on processing status
              // setUploadedFile(null); // REMOVED - causes dashboard to disappear in ProjectPage
            } catch (error) {
              console.error('Failed to load conversation for dashboard response:', error);
              // No fallback message
              updateMessages((prev) => ([
                ...prev,
                {
                  id: (Date.now() + 3).toString(),
                  role: 'assistant',
                  content: "",
                  dashboardCard: {
                    sourceFileName: get().uploadedFiles[0]?.filename ?? "dashboard",
                    dashboardId: "",
                    accountName: get().uploadedFiles[0]?.accountName,
                    sourceType: get().uploadedFiles[0]?.sourceType,
                  },
                  timestamp: new Date(),
                }
              ]));

              // DON'T clear uploadedFile - see comment above
              // setUploadedFile(null); // REMOVED
            }

            if (conversationId) {
              setCurrentConversationId(conversationId);
            }
          } else {
            // Q&A text response (with @mentioned file) - load conversation and show response
            console.log('Q&A response detected (no dashboard_data) - loading conversation');
            try {
              const { conversationService } = await import('@/services/conversationService');
              const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
              const conversation = conversationResponse.conversation;
              const restoredMessages = conversationNodesToMessages(conversation);
              console.log('Q&A conversation loaded, restored', restoredMessages.length, 'messages');
              if (restoredMessages.length) {
                get().setMessages(restoredMessages);

                // Auto-open dashboard if the latest message includes a dashboard card
                const lastMsg = restoredMessages[restoredMessages.length - 1];
                const dashId = lastMsg?.dashboardCard?.dashboardId;
                if (dashId) {
                  set({
                    isDashboardOpen: true,
                    hasShownInitialDashboard: true,
                    isInitialLoading: false,
                  });
                  get().selectDashboard(dashId, projectId).then((data) => {
                    if (data && onProcessedDataChange) {
                      onProcessedDataChange(data);
                    }
                  });
                }
              }
            } catch (error) {
              console.error('Failed to load conversation for Q&A response:', error);
              // Fallback to workflow status metadata
              const workflowStatus = finalResult.data?.workflow_status;
              const responseText = workflowStatus?.metadata?.content ||
                workflowStatus?.message ||
                "I've processed your question.";

              updateMessages((prev) => ([
                ...prev,
                {
                  id: (Date.now() + 1).toString(),
                  role: 'assistant',
                  content: responseText,
                  timestamp: new Date(),
                }
              ]));
            }
          }
        } else {
          // Explicitly handle error status from polling
          if (finalResult.data?.status === 'error' || !finalResult.success) {
            const errorMsg = finalResult.data?.error || 'An error occurred while processing your request.';
            get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));

            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          } else {
            // Timeout or unknown state — show explicit error to user
            const timeoutMsg = finalResult.data?.error || 'Processing timed out. Please try again.';
            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          }
        }
      } else {
        // startResult failed — show error to user
        const startErrorMsg = startResult.data?.error || 'Failed to start processing.';
        updateMessages((prev) => ([
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Error while generating dashboard',
            timestamp: new Date(),
            isError: true,
          }
        ]));
      }
    } catch (error) {
      console.error('Processing error:', error);
      get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
      const errObj = error as Record<string, unknown>;
      const errDetail = (errObj?.response as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
      const isInsufficientCredits =
        errObj?.status === 402 ||
        (errDetail as Record<string, unknown> | undefined)?.error === 'insufficient_credits' ||
        (errObj?.detail as Record<string, unknown> | undefined)?.error === 'insufficient_credits';
      updateMessages((prev) => ([
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Error while generating dashboard',
          timestamp: new Date(),
          isError: true,
          isInsufficientCredits,
        }
      ]));
    } finally {
      setIsTyping(false);
      setIsProcessing(false);
      set({ isUpdatingDashboard: false, abortController: null });
    }
  },

  resumeWorkflowPolling: async (projectId: string, conversationId: string, onProcessedDataChange?: (data: any) => void) => {
    // Pre-check (synchronous): processFileWithMessage sets abortController synchronously
    // before its first await, so this catches concurrent fresh-start workflows
    if (get().abortController !== null || get().isProcessing) return;

    const { processingService } = await import('@/services/processingService');

    // Check if a workflow is actually in progress before doing anything
    const statusCheck = await processingService.getWorkflowStatus(conversationId, projectId);
    if (statusCheck.data?.status !== 'processing') {
      // Not actively processing (completed, error, stopped, starting/404) — nothing to resume
      return;
    }

    // Post-check: close the race window — processFileWithMessage may have started while
    // getWorkflowStatus was in-flight (abortController is set synchronously, isProcessing lags)
    if (get().abortController !== null || get().isProcessing) return;

    const { setIsProcessing, setIsTyping, setCurrentWorkflowStep, setCurrentConversationId } = get();

    // Seed the step display with whatever the backend currently reports
    const initialStep = statusCheck.data?.workflow_status?.metadata?.step;
    if (initialStep) {
      setCurrentWorkflowStep(initialStep);
      // Compute all steps that logically preceded this one so the UI can show them as completed
      const stepIdx = STEP_ORDER.indexOf(initialStep);
      const priorSteps = stepIdx > 0 ? STEP_ORDER.slice(0, stepIdx) : [];
      set({ priorWorkflowSteps: priorSteps });
    }

    const abortController = new AbortController();
    set({ abortController, isProcessing: true, isTyping: true });
    setCurrentConversationId(conversationId);

    try {
      const finalResult = await processingService.pollProcessingStatus(
        '',
        projectId,
        conversationId,
        (status) => {
          const workflowStatus = status.data?.workflow_status?.status;
          if (workflowStatus === 'error' || workflowStatus === 'stopped') {
            setIsProcessing(false);
            setIsTyping(false);
          }
          const step = status.data?.workflow_status?.metadata?.step;
          if (step) setCurrentWorkflowStep(step);
        },
        360,
        5000,
        abortController.signal
      );

      if (finalResult.data?.success && finalResult.data?.status === 'completed') {
        const { conversationService } = await import('@/services/conversationService');
        const { conversationNodesToMessages } = await import('@/chat/conversationToMessages');
        const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
        const conversation = conversationResponse.conversation;
        const restoredMessages = conversationNodesToMessages(conversation);
        if (restoredMessages.length) {
          get().setMessages(restoredMessages);
        }

        // Auto-open dashboard if the latest message has a dashboard card
        const lastMsg = restoredMessages[restoredMessages.length - 1];
        const dashId = lastMsg?.dashboardCard?.dashboardId;
        if (dashId) {
          const restoredTemplateOnResume = resolveTemplate(getTemplateIdForDashboard(dashId));
          set({ selectedDashboardId: dashId, isDashboardOpen: true, hasShownInitialDashboard: true, isInitialLoading: false, selectedTemplate: restoredTemplateOnResume });
          get().selectDashboard(dashId, projectId).then((data) => {
            if (data && onProcessedDataChange) onProcessedDataChange(data);
          });
        } else if (finalResult.data?.dashboard_data && onProcessedDataChange) {
          onProcessedDataChange(finalResult.data.dashboard_data);
        }
      }
    } catch (error) {
      console.error('Failed to resume workflow polling:', error);
    } finally {
      setIsTyping(false);
      setIsProcessing(false);
      set({ abortController: null });
    }
  },

  stopGeneration: async () => {
    const state = get();
    const { abortController, currentConversationId, setIsProcessing, setIsTyping } = state;

    // Abort the polling if controller exists
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }

    if (currentConversationId) {
      try {
        const projectId = state.currentProjectId || state.uploadedFiles[0]?.projectId;
        if (projectId) {
          const { conversationService } = await import('@/services/conversationService');
          await conversationService.stopWorkflow(currentConversationId, projectId);
        }
      } catch (error) {
        console.error('Failed to stop workflow:', error);
      }
    }

    // Clear abort controller and update state
    set({
      abortController: null,
      isProcessing: false,
      isTyping: false,
    });
  },

  resetChat: (preserveTemplate = false) => {
    if (!preserveTemplate) {
      try { localStorage.removeItem('dreamify_selected_template'); } catch {}
    }
    set({
      inputValue: "",
      isTyping: false,
      messages: initialMessages,
      uploadedFiles: [],
      currentConversationId: null,
      isProcessing: false,
      currentWorkflowStep: null,
      priorWorkflowSteps: [],
      dropdownOpen: false,
      selectedDataSource: "",
      isListening: false,
      transcript: "",
      detectedLanguage: null,
      selectedDashboardId: null,
      selectedTemplate: preserveTemplate ? get().selectedTemplate : null,
      // We explicitly DO NOT clear integration modal states here
      // to preserve them across navigation/reloads during picking.
    });
  },

  selectDashboard: async (dashboardId: string, projectId: string): Promise<any> => {
    const { currentConversationId, updateFile } = get();
    if (!currentConversationId) return null;

    try {
      const { conversationService } = await import('@/services/conversationService');
      const response = await conversationService.getDashboardData(
        currentConversationId,
        projectId,
        dashboardId
      );

      if (response?.dashboard_data) {
        // Restore the template that was used when this dashboard was generated
        const restoredTemplate = resolveTemplate(getTemplateIdForDashboard(dashboardId));
        try { localStorage.removeItem('dreamify_selected_template'); } catch { }
        set({ selectedDashboardId: dashboardId, selectedTemplate: restoredTemplate });
        // Update file only if one exists in store
        const files = get().uploadedFiles;
        if (files.length > 0) {
          updateFile(files[0].fileID, { processedData: response.dashboard_data });
        }
        return response.dashboard_data;
      }
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    }
    return null;
  },
}));
