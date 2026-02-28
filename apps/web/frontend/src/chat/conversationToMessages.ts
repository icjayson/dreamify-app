import type { Message } from '@/types/message';

export interface ConversationNodesToMessagesOptions {
  sourceFileName?: string;
  lastUserMessageAttachment?: {
    kind: 'file' | 'csv';
    name: string;
    mime?: string;
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
      const assetContents = node?.contents?.filter?.(
        (c: any) =>
          c?.type === 'asset' || c?.type === 'attachment' || c?.type === 'file' || c?.type === 'mention'
      ) ?? [];
      const assetContent = assetContents[0];
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
      // Include attachment field for messages with asset content
      // This shows "Attached file" badge for @mentioned files in QnA mode
      // FALLBACK: If assetContent is missing but this is the last user node and we have a fallback, use it.
      if (assetContent?.data) {
        const firstName =
          assetContent?.data?.filename ||
          assetContent?.data?.name ||
          assetName;
        normalized.attachment = {
          kind: assetContent?.data?.kind === 'file' ? 'file' : 'csv',
          name: assetContents.length > 1 ? `${assetContents.length} files` : firstName,
          mime: assetContent?.data?.mime,
        };
      } else if (isLastUser && options?.lastUserMessageAttachment) {
        normalized.attachment = options.lastUserMessageAttachment;
      }
      return normalized;
    });

  return restoredMessages;
}
