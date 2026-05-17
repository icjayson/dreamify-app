import type { Message } from '@/types/message';
import { EXPLICIT_PROMPT_THEME_SOURCE } from '@/types/message';
import { ChartType, type DashboardComponent } from '@/types/dashboard';
import { createThemeSelection } from '@/constants/builtinTemplates';
import { normalizeConnectorSource } from '@/utils/dataContextTokens';

export interface ConversationNodesToMessagesOptions {
  sourceFileName?: string;
  lastUserMessageAttachment?: {
    kind: 'file' | 'csv';
    name: string;
    mime?: string;
    sourceType?: string;
    accountName?: string;
    propertyName?: string;
    syncVersionName?: string;
    files?: Array<{
      id: string;
      name: string;
      ext?: string;
      sourceType?: string;
      accountName?: string;
      propertyName?: string;
      syncVersionName?: string;
    }>;
  };
}

type MessageVisualArtifact = NonNullable<Message['visualArtifacts']>[number];
type VisualArtifactPayload = Record<string, unknown>;
type ConversationNodeContent = {
  type?: string;
  data?: Record<string, unknown>;
};
type ConversationNode = {
  node_id?: string;
  role?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
  contents?: ConversationNodeContent[];
};
type ConversationDashboard = {
  dashboard_id?: string;
  title?: string;
};

function asPayload(value: unknown): VisualArtifactPayload | null {
  return value && typeof value === 'object' ? value as VisualArtifactPayload : null;
}

function asMetadataString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function hasExplicitPromptTheme(metadata: Record<string, unknown>): boolean {
  return metadata.theme_source === EXPLICIT_PROMPT_THEME_SOURCE;
}

function getAssetSelectionMode(metadata: Record<string, unknown>): string | null {
  const direct = metadata.asset_selection;
  if (typeof direct === 'string') return direct;

  const nested = asPayload(metadata.user_node_metadata);
  const nestedMode = nested?.asset_selection;
  return typeof nestedMode === 'string' ? nestedMode : null;
}

function allowsLastUserAttachmentFallback(metadata: Record<string, unknown>): boolean {
  return getAssetSelectionMode(metadata) !== 'none';
}

type MessageAttachmentFile = NonNullable<NonNullable<Message['attachment']>['files']>[number];

function compact<T>(items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function normalizeNodeContent(raw: unknown): ConversationNodeContent | null {
  const payload = asPayload(raw);
  if (!payload) return null;
  return {
    type: readString(payload.type),
    data: asPayload(payload.data) || {},
  };
}

function normalizeConversationNode(raw: unknown): ConversationNode | null {
  const payload = asPayload(raw);
  if (!payload) return null;
  return {
    node_id: readString(payload.node_id),
    role: readString(payload.role),
    created_at: readString(payload.created_at),
    metadata: asPayload(payload.metadata) || {},
    contents: Array.isArray(payload.contents)
      ? compact(payload.contents.map(normalizeNodeContent))
      : [],
  };
}

function normalizeConversationDashboard(raw: unknown): ConversationDashboard | null {
  const payload = asPayload(raw);
  if (!payload) return null;
  return {
    dashboard_id: readString(payload.dashboard_id),
    title: readString(payload.title),
  };
}

function normalizeAttachmentFile(data: Record<string, unknown>): MessageAttachmentFile | null {
  const id = readString(data.id) || readString(data.asset_id) || readString(data.file_id);
  const name = readString(data.name) || readString(data.filename);
  if (!id || !name || id === 'all-assets') return null;

  return {
    id,
    name,
    ext: readString(data.extension) || readString(data.ext),
    sourceType: normalizeConnectorSource(readString(data.sourceType))?.name || readString(data.sourceType),
    accountName: readString(data.accountName) || readString(data.account_name),
    propertyName: readString(data.propertyName) || readString(data.property_name),
    syncVersionName: readString(data.syncVersionName) || readString(data.sync_version_name),
  };
}

function normalizeVisualArtifact(raw: unknown, index: number): MessageVisualArtifact | null {
  if (!raw || typeof raw !== 'object') return null;
  const artifact = raw as VisualArtifactPayload;

  const existingComponent = artifact.component && typeof artifact.component === 'object'
    ? artifact.component as DashboardComponent
    : null;
  const existingConfig = asPayload(existingComponent?.component_config);
  const kind = (artifact.kind || existingComponent?.type || '').toString().toLowerCase();
  const normalizedKind = kind === 'table' ? 'table' : 'chart';
  const id = String(artifact.id || existingComponent?.id || `artifact_${index + 1}`);
  const title = String(
    artifact.title ||
    existingConfig?.title ||
    (normalizedKind === 'table' ? 'Table' : 'Chart')
  );
  const description = (artifact.description || existingConfig?.description) as string | undefined;

  if (existingComponent) {
    return {
      id,
      kind: normalizedKind,
      title,
      description,
      component: existingComponent,
    };
  }

  const position = artifact.position || artifact.layout || {
    x: 0,
    y: 0,
    width: normalizedKind === 'table' ? 24 : 18,
    height: normalizedKind === 'table' ? 10 : 12,
  };

  if (normalizedKind === 'table') {
    const columns = Array.isArray(artifact.columns) ? artifact.columns : [];
    const data = Array.isArray(artifact.data) ? artifact.data : [];
    if (columns.length === 0 || data.length === 0) return null;
    return {
      id,
      kind: 'table',
      title,
      description,
      component: {
        id,
        type: 'table',
        position,
        component_config: {
          id,
          title,
          description,
          columns,
          data,
          styling: artifact.styling,
        },
      },
    };
  }

  const chartType = String(artifact.chart_type || artifact.type || ChartType.BAR) as ChartType;
  const datasets = Array.isArray(artifact.datasets) ? artifact.datasets : [];
  if (datasets.length === 0) return null;

  return {
    id,
    kind: 'chart',
    title,
    description,
    component: {
      id,
      type: 'chart',
      position,
      component_config: {
        id,
        type: chartType,
        title,
        description,
        datasets,
        config: artifact.config || {},
        layout: artifact.layout,
        styling: artifact.styling,
        metadata: artifact.metadata,
      },
    },
  };
}

function getNoAnswerClarificationResponse(node: unknown): { clarificationId: string; resolvedAt?: string } | null {
  const nodePayload = asPayload(node);
  if (nodePayload?.role !== 'user') return null;
  const contents = Array.isArray(nodePayload.contents) ? nodePayload.contents : [];
  const responseContent = contents.find((content) => {
    const contentPayload = asPayload(content);
    const data = asPayload(contentPayload?.data) || {};
    return (
      contentPayload?.type === 'clarification_response'
      && data?.answer_status === 'no_answer'
      && typeof data?.clarification_id === 'string'
      && data.clarification_id.trim().length > 0
    );
  });
  const responseData = asPayload(asPayload(responseContent)?.data);
  const clarificationId = responseData?.clarification_id;
  if (typeof clarificationId !== 'string' || !clarificationId.trim()) return null;
  return {
    clarificationId: clarificationId.trim(),
    resolvedAt: readString(nodePayload?.created_at),
  };
}

/**
 * Converts conversation nodes (and dashboards) to chat Message[] in workflow order.
 * Filters to user + assistant nodes with renderable content; excludes tool-only assistant nodes.
 */
export function conversationNodesToMessages(
  conversation: { nodes?: unknown[]; dashboards?: unknown[] },
  options?: ConversationNodesToMessagesOptions
): Message[] {
  const nodes = compact((conversation?.nodes ?? []).map(normalizeConversationNode));
  const dashboards = compact((conversation?.dashboards ?? []).map(normalizeConversationDashboard));
  const noAnswerClarifications = new Map<string, { resolvedAt?: string }>();
  nodes.forEach((node) => {
    const noAnswer = getNoAnswerClarificationResponse(node);
    if (noAnswer) {
      noAnswerClarifications.set(noAnswer.clarificationId, { resolvedAt: noAnswer.resolvedAt });
    }
  });

  // Asset name / account info will track the most recent asset encountered in the flow
  let currentAssetName = options?.sourceFileName ?? 'dashboard';
  let currentAccountName: string | undefined = options?.lastUserMessageAttachment?.accountName;
  let currentSourceType: string | undefined = options?.lastUserMessageAttachment?.sourceType;

  const restoredMessages: Message[] = nodes
    .filter((node) => {
      if (!node) return false;
      if (node.role === 'user') return !getNoAnswerClarificationResponse(node);
      if (node.role === 'assistant') {
        const metadata = node.metadata || {};
        const hasToolCalls = Array.isArray(metadata.tool_calls) && metadata.tool_calls.length > 0;
        if (hasToolCalls || metadata.tool_call_id) return false;
        const hasRenderableContent = node.contents?.some?.((c) => {
          if (c?.type === 'text') {
            const text = c?.data?.text;
            return typeof text === 'string' && text.trim().length > 0;
          }
          return c?.type === 'dashboard' || c?.type === 'todo_tasks' || c?.type === 'thinking_trace' || c?.type === 'clarification_request';
        });
        return !!hasRenderableContent;
      }
      return false;
    })
    .map((node, index, array) => {
      const isLastUser = node.role === 'user' && array.slice(index + 1).findIndex((n) => n.role === 'user') === -1;
      const isAwaitingClarificationForUser = node.role === 'user' && array
        .slice(index + 1)
        .some((n) => (
          n.role === 'assistant' &&
          n.contents?.some((content) => content.type === 'clarification_request')
        ));

      const textContent = node.contents?.find((c) => c.type === 'text');
      const metadata = node?.metadata || {};
      const dashboardContent = node.contents?.find((c) => c.type === 'dashboard');
      const todoTasksContent = node.contents?.find((c) => c.type === 'todo_tasks');
      const thinkingTraceContent = node.contents?.find((c) => c.type === 'thinking_trace');
      const clarificationRequestContent = node.contents?.find((c) => c.type === 'clarification_request');
      const visualArtifactsContent = node.contents?.find((c) => c.type === 'visual_artifacts');
      const assetContents = node.contents?.filter(
        (c) =>
          c?.type === 'asset' || c?.type === 'attachment' || c?.type === 'file' || c?.type === 'mention'
      ) ?? [];
      const assetContent = assetContents[0];
      const chartMentionContents = node.contents?.filter(
        (c) => c?.type === 'chart_mention'
      ) ?? [];

      // Update the current asset name/account info if this node brings a new asset
      if (assetContent?.data?.filename) {
        currentAssetName = assetContent.data.filename;
      }
      if (assetContent?.data?.accountName) {
        currentAccountName = assetContent.data.accountName;
      }
      const normalized: Message = {
        id: node?.node_id || crypto.randomUUID(),
        role: node?.role === 'user' ? 'user' : 'assistant',
        content: textContent?.data?.text || '',
        timestamp: new Date(node?.created_at || Date.now()),
      };
      if (normalized.role === 'user' && hasExplicitPromptTheme(metadata)) {
        const themeId = asMetadataString(metadata.theme_id) || asMetadataString(metadata.template_id);
        const analysisFocusId = asMetadataString(metadata.analysis_focus_id) || asMetadataString(metadata.template_id);
        const themeSelection = createThemeSelection(themeId || analysisFocusId, analysisFocusId);
        if (themeSelection) {
          normalized.template = themeSelection;
        }
      }
      if (dashboardContent) {
        const dashboardId = dashboardContent.data?.dashboard_id || '';
        const dashboardMetadata = dashboards.find(
          (d) => d.dashboard_id === dashboardId
        );
        normalized.dashboardCard = {
          sourceFileName: currentAssetName,
          dashboardId: dashboardId,
          dashboardTitle: dashboardMetadata?.title || undefined,
          accountName: currentAccountName,
          sourceType: currentSourceType,
        };
      }
      if (todoTasksContent?.data?.tasks && Array.isArray(todoTasksContent.data.tasks)) {
        normalized.todoTasks = todoTasksContent.data.tasks;
      }
      if (thinkingTraceContent?.data?.events && Array.isArray(thinkingTraceContent.data.events)) {
        normalized.thinkingTrace = thinkingTraceContent.data.events;
      }
      if (clarificationRequestContent?.data) {
        normalized.clarificationRequest = clarificationRequestContent.data;
        const clarificationId = readString(clarificationRequestContent.data.clarification_id);
        const noAnswer = clarificationId ? noAnswerClarifications.get(clarificationId) : null;
        if (clarificationId && noAnswer) {
          normalized.clarificationResolution = {
            clarification_id: clarificationId,
            status: 'no_answer',
            question: readString(clarificationRequestContent.data.question) || 'Clarification question',
            resolved_at: noAnswer.resolvedAt,
          };
        }
      }
      if (Array.isArray(visualArtifactsContent?.data?.artifacts)) {
        const artifacts = visualArtifactsContent.data.artifacts
          .map((artifact, artifactIndex) => normalizeVisualArtifact(artifact, artifactIndex))
          .filter(Boolean);
        if (artifacts.length > 0) {
          normalized.visualArtifacts = artifacts;
        }
      }
      // Include attachment field for messages with asset content
      // This shows "Attached file" badge for @mentioned files in QnA mode
      // FALLBACK: If assetContent is missing but this is the last user node and we have a fallback, use it.
      if (assetContent?.data) {
        const firstName =
          assetContent?.data?.filename ||
          assetContent?.data?.name ||
          currentAssetName;

        const getSourceTypeFromRaw = (raw?: string): string | undefined => normalizeConnectorSource(raw)?.name;

        // Derive sourceType from asset_type stored in the conversation node
        const assetType: string = assetContent?.data?.sourceType || '';
        const fileName: string = firstName || '';
        const filesFromNodeContents = assetContents
          .map((content) => normalizeAttachmentFile(asPayload(content?.data) || {}))
          .filter(Boolean) as NonNullable<Message['attachment']>['files'];
        const filesFromSyntheticMention = Array.isArray(assetContent?.data?.files)
          ? assetContent.data.files
            .map((file: unknown) => normalizeAttachmentFile(asPayload(file) || {}))
            .filter(Boolean) as NonNullable<Message['attachment']>['files']
          : [];
        const fallbackFiles = options?.lastUserMessageAttachment?.files ?? [];
        const attachmentFiles = filesFromNodeContents.length
          ? filesFromNodeContents
          : filesFromSyntheticMention.length
            ? filesFromSyntheticMention
            : assetContent?.data?.asset_id === 'all-assets'
              ? fallbackFiles
              : [];
        const sourceType = attachmentFiles.length > 1 || assetContents.length > 1
          ? 'Multiple'
          : getSourceTypeFromRaw(assetType);

        // Track current sourceType for dashboard cards
        if (sourceType) currentSourceType = sourceType;

        normalized.attachment = {
          kind: assetContent?.data?.kind === 'file' ? 'file' : 'csv',
          name: assetContents.length > 1 ? `${assetContents.length} files` : firstName,
          mime: assetContent?.data?.mime,
          sourceType,
          accountName: assetContent?.data?.accountName,
          propertyName: assetContent?.data?.propertyName,
          syncVersionName: assetContent?.data?.syncVersionName || assetContent?.data?.sync_version_name,
          files: attachmentFiles,
        };
      } else if (
        isLastUser &&
        options?.lastUserMessageAttachment &&
        !isAwaitingClarificationForUser &&
        allowsLastUserAttachmentFallback(metadata)
      ) {
        normalized.attachment = options.lastUserMessageAttachment;
      }
      // Restore chart mentions from conversation nodes
      if (chartMentionContents.length > 0) {
        normalized.chartMentions = chartMentionContents.map((c) => ({
          title: c.data?.title || '',
          type: c.data?.chart_type || 'bar',
          componentId: c.data?.component_id || c.data?.chart_id || '',
        }));
      }

      // If assistant message has a dashboard card but no text content,
      // check the preceding user message for chart mentions and generate a meaningful response
      if (normalized.role === 'assistant' && normalized.dashboardCard && !normalized.content) {
        // Look backward for the most recent user message with chart mentions
        const prevUserNodes = nodes
          .slice(0, nodes.indexOf(node))
          .filter((n) => n.role === 'user')
          .reverse();
        const prevUser = prevUserNodes[0];
        const prevChartMentions = prevUser?.contents?.filter(
          (c) => c?.type === 'chart_mention'
        ) ?? [];
        if (prevChartMentions.length > 0) {
          const chartNames = prevChartMentions.map((c) => c.data?.title || 'chart').join(', ');
          normalized.content = `Done! I've updated ${chartNames}. The dashboard has been refreshed with the changes.`;
        }
      }

      return normalized;
    });

  // Post-processing: find user messages whose assistant responses were filtered out
  // (e.g., chart edit responses with no text/dashboard content) and synthesize responses.
  // Walk through the original nodes to detect (user → assistant) pairs where the assistant was dropped.
  const restoredNodeIds = new Set(restoredMessages.map(m => m.id));
  const finalMessages: Message[] = [];

  for (let i = 0; i < restoredMessages.length; i++) {
    const msg = restoredMessages[i];
    finalMessages.push(msg);

    // After each user message, check if there should be an assistant response
    if (msg.role === 'user') {
      const nextRestored = restoredMessages[i + 1];
      // If next restored message is already an assistant, skip — response exists
      if (nextRestored?.role === 'assistant') continue;

      // Find this user's node in the original nodes array
      const userNodeIndex = nodes.findIndex((n) => n.node_id === msg.id);
      if (userNodeIndex < 0) continue;

      // Check if there's an assistant node after this user node in the original array
      const subsequentAssistant = nodes.slice(userNodeIndex + 1).find((n) => n.role === 'assistant');
      if (!subsequentAssistant) continue;

      // The assistant node exists but was filtered out — synthesize a response
      const chartMentions = msg.chartMentions;
      let responseContent = 'Your dashboard has been updated with the requested changes.';
      if (chartMentions?.length) {
        const chartNames = chartMentions.map(c => c.title).filter(Boolean).join(', ');
        responseContent = `Done! I've updated ${chartNames || 'the chart'}. The dashboard has been refreshed with your changes.`;
      }

      // Find the relevant dashboard
      const dashboardContentInAssistant = subsequentAssistant?.contents?.find((c) => c?.type === 'dashboard');
      const dashboardId = dashboardContentInAssistant?.data?.dashboard_id || '';
      const dashboardMeta = dashboards.find((d) => d.dashboard_id === dashboardId) || dashboards[dashboards.length - 1];

      finalMessages.push({
        id: subsequentAssistant.node_id || crypto.randomUUID(),
        role: 'assistant',
        content: responseContent,
        timestamp: new Date(subsequentAssistant.created_at || Date.now()),
        ...(dashboardMeta ? {
          dashboardCard: {
            sourceFileName: currentAssetName,
            dashboardId: dashboardMeta.dashboard_id || '',
            dashboardTitle: dashboardMeta.title || undefined,
          }
        } : {}),
      });
    }
  }

  return finalMessages;
}
