import type { Message } from '@/types/message';

export interface ConversationNodesToMessagesOptions {
  sourceFileName?: string;
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

  // Derive asset name from first asset in nodes, unless overridden
  let assetName = options?.sourceFileName;
  if (assetName === undefined) {
    for (const node of nodes) {
      const contents = node?.contents || [];
      for (const content of contents) {
        if (content?.type === 'asset' || content?.type === 'attachment') {
          const assetData = content?.data || {};
          if (assetData.asset_id) {
            assetName = assetData.filename || 'dashboard';
            break;
          }
        }
      }
      if (assetName !== undefined) break;
    }
    assetName = assetName ?? 'dashboard';
  }

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
          return c?.type === 'dashboard';
        });
        return !!hasRenderableContent;
      }
      return false;
    })
    .map((node: any) => {
      const textContent = node?.contents?.find?.((c: any) => c?.type === 'text');
      const dashboardContent = node?.contents?.find?.((c: any) => c?.type === 'dashboard');
      const assetContent = node?.contents?.find?.(
        (c: any) =>
          c?.type === 'asset' || c?.type === 'attachment' || c?.type === 'file'
      );
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
          sourceFileName: assetName,
          dashboardId: dashboardId,
          dashboardTitle: dashboardMetadata?.title || undefined,
        };
      }
      if (assetContent?.data) {
        normalized.attachment = {
          kind: assetContent?.data?.kind === 'file' ? 'file' : 'csv',
          name:
            assetContent?.data?.filename ||
            assetContent?.data?.name ||
            assetName,
          mime: assetContent?.data?.mime,
        };
      }
      return normalized;
    });

  return restoredMessages;
}
