import type { Message } from '@/types/message';
import { ChartType, type DashboardComponent } from '@/types/dashboard';

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

function asPayload(value: unknown): VisualArtifactPayload | null {
  return value && typeof value === 'object' ? value as VisualArtifactPayload : null;
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

/**
 * Converts conversation nodes (and dashboards) to chat Message[] in workflow order.
 * Filters to user + assistant nodes with renderable content; excludes tool-only assistant nodes.
 */
export function conversationNodesToMessages(
  conversation: { nodes?: any[]; dashboards?: any[] },
  options?: ConversationNodesToMessagesOptions
): Message[] {
  const nodes = conversation?.nodes ?? [];
  const dashboards = conversation?.dashboards ?? [];

  // Asset name / account info will track the most recent asset encountered in the flow
  let currentAssetName = options?.sourceFileName ?? 'dashboard';
  let currentAccountName: string | undefined = options?.lastUserMessageAttachment?.accountName;
  let currentSourceType: string | undefined = options?.lastUserMessageAttachment?.sourceType;

  const restoredMessages: Message[] = nodes
    .filter((node: any) => {
      if (!node) return false;
      if (node.role === 'user') return true;
      if (node.role === 'assistant') {
        const metadata = node.metadata || {};
        const hasToolCalls = Array.isArray(metadata.tool_calls) && metadata.tool_calls.length > 0;
        if (hasToolCalls || metadata.tool_call_id) return false;
        const hasRenderableContent = node.contents?.some?.((c: any) => {
          if (c?.type === 'text') {
            const text = c?.data?.text;
            return typeof text === 'string' && text.trim().length > 0;
          }
          return c?.type === 'dashboard' || c?.type === 'todo_tasks' || c?.type === 'thinking_trace';
        });
        return !!hasRenderableContent;
      }
      return false;
    })
    .map((node: any, index: number, array: any[]) => {
      // Check if this is the last user node in the filtered list
      const isLastUserNode = node.role === 'user' && index === array.filter(n => n.role === 'user').length - 1; // Wait, array is ALL filtered nodes. 
      // Correct logic to find if it's the last user node:
      // We can't easily know if it's the "last user node" of the ENTIRE conversation relative to the time, 
      // but we can check if it's the last node in the array that IS a user node.
      // Actually, simplest is to check if it's the *last node overall* if the last node is user, but usually last node is assistant.

      // Let's refine the "last user node" check in the context of the map.
      // We need to identify the user node that triggered the current response.
      // Generally, that's the last user node in the list.

      // Since `map` doesn't give context of "last of type", let's assume we simply want to attach to the VERY LAST user node found.
      const isLastUser = node.role === 'user' && array.slice(index + 1).findIndex((n: any) => n.role === 'user') === -1;

      const textContent = node?.contents?.find?.((c: any) => c?.type === 'text');
      const dashboardContent = node?.contents?.find?.((c: any) => c?.type === 'dashboard');
      const todoTasksContent = node?.contents?.find?.((c: any) => c?.type === 'todo_tasks');
      const thinkingTraceContent = node?.contents?.find?.((c: any) => c?.type === 'thinking_trace');
      const visualArtifactsContent = node?.contents?.find?.((c: any) => c?.type === 'visual_artifacts');
      const assetContents = node?.contents?.filter?.(
        (c: any) =>
          c?.type === 'asset' || c?.type === 'attachment' || c?.type === 'file' || c?.type === 'mention'
      ) ?? [];
      const assetContent = assetContents[0];
      const chartMentionContents = node?.contents?.filter?.(
        (c: any) => c?.type === 'chart_mention'
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
      if (dashboardContent) {
        const dashboardId = dashboardContent.data?.dashboard_id || '';
        const dashboardMetadata = dashboards.find(
          (d: any) => d.dashboard_id === dashboardId
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
      if (Array.isArray(visualArtifactsContent?.data?.artifacts)) {
        const artifacts = visualArtifactsContent.data.artifacts
          .map((artifact: any, artifactIndex: number) => normalizeVisualArtifact(artifact, artifactIndex))
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

        const getSourceTypeFromRaw = (raw?: string): string | undefined => {
          const lower = (raw || '').toLowerCase();
          if (lower.includes('ga4') || lower.includes('google_analytics') || lower.includes('google analytics')) return 'GA4';
          if (lower.includes('sheet') || lower.includes('google sheets')) return 'Google Sheets';
          if (lower.includes('meta') || lower.includes('meta_ads')) return 'Meta Ads';
          if (lower.includes('tiktok') || lower.includes('tik_tok')) return 'TikTok';
          if (lower.includes('google ads') || lower.includes('google_ads')) return 'Google Ads';
          if (lower.includes('firebase')) return 'Firebase';
          if (lower.includes('appsflyer')) return 'AppsFlyer';
          if (lower.includes('stripe')) return 'Stripe';
          return undefined;
        };

        // Derive sourceType from asset_type stored in the conversation node
        const assetType: string = assetContent?.data?.sourceType || '';
        const fileName: string = firstName || '';
        const sourceType = assetContents.length > 1 ? 'Multiple' : getSourceTypeFromRaw(assetType);
        const attachmentFiles = assetContents
          .map((content: any) => {
            const data = content?.data || {};
            const id = data.asset_id || data.file_id;
            const name = data.filename || data.name;
            if (!id || !name || id === 'all-assets') return null;
            return {
              id,
              name,
              ext: data.extension || data.ext,
              sourceType: getSourceTypeFromRaw(data.sourceType),
              accountName: data.accountName,
              propertyName: data.propertyName,
              syncVersionName: data.syncVersionName || data.sync_version_name,
            };
          })
          .filter(Boolean) as NonNullable<Message['attachment']>['files'];

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
      } else if (isLastUser && options?.lastUserMessageAttachment) {
        normalized.attachment = options.lastUserMessageAttachment;
      }
      // Restore chart mentions from conversation nodes
      if (chartMentionContents.length > 0) {
        normalized.chartMentions = chartMentionContents.map((c: any) => ({
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
          .filter((n: any) => n.role === 'user')
          .reverse();
        const prevUser = prevUserNodes[0];
        const prevChartMentions = prevUser?.contents?.filter?.(
          (c: any) => c?.type === 'chart_mention'
        ) ?? [];
        if (prevChartMentions.length > 0) {
          const chartNames = prevChartMentions.map((c: any) => c.data?.title || 'chart').join(', ');
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
      const userNodeIndex = nodes.findIndex((n: any) => n.node_id === msg.id);
      if (userNodeIndex < 0) continue;

      // Check if there's an assistant node after this user node in the original array
      const subsequentAssistant = nodes.slice(userNodeIndex + 1).find((n: any) => n.role === 'assistant');
      if (!subsequentAssistant) continue;

      // The assistant node exists but was filtered out — synthesize a response
      const chartMentions = msg.chartMentions;
      let responseContent = 'Your dashboard has been updated with the requested changes.';
      if (chartMentions?.length) {
        const chartNames = chartMentions.map(c => c.title).filter(Boolean).join(', ');
        responseContent = `Done! I've updated ${chartNames || 'the chart'}. The dashboard has been refreshed with your changes.`;
      }

      // Find the relevant dashboard
      const dashboardContentInAssistant = subsequentAssistant?.contents?.find?.((c: any) => c?.type === 'dashboard');
      const dashboardId = dashboardContentInAssistant?.data?.dashboard_id || '';
      const dashboardMeta = dashboards.find((d: any) => d.dashboard_id === dashboardId) || dashboards[dashboards.length - 1];

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
