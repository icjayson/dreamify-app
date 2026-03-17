import type { Message } from '@/types/message';

export interface ConversationNodesToMessagesOptions {
  sourceFileName?: string;
  lastUserMessageAttachment?: {
    kind: 'file' | 'csv';
    name: string;
    mime?: string;
    sourceType?: string;
    accountName?: string;
    propertyName?: string;
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

  // Asset name will track the most recent asset encountered in the flow
  let currentAssetName = options?.sourceFileName ?? 'dashboard';

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

      // Update the current asset name if this node brings a new asset
      if (assetContent?.data?.filename) {
        currentAssetName = assetContent.data.filename;
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
        };
      }
      // Include attachment field for messages with asset content
      // This shows "Attached file" badge for @mentioned files in QnA mode
      // FALLBACK: If assetContent is missing but this is the last user node and we have a fallback, use it.
      if (assetContent?.data) {
        const firstName =
          assetContent?.data?.filename ||
          assetContent?.data?.name ||
          currentAssetName;

        // Derive sourceType from asset_type stored in the conversation node
        const assetType: string = assetContent?.data?.asset_type || assetContent?.data?.source_type || '';
        const fileName: string = firstName || '';
        let sourceType: string | undefined;
        const lowerAssetType = assetType.toLowerCase();
        const lowerFileName = fileName.toLowerCase();

        if (assetContents.length > 1) {
          sourceType = 'Multiple';
        } else if (lowerAssetType.includes('ga4') || lowerAssetType.includes('google_analytics') || lowerAssetType.includes('google analytics')) {
          sourceType = 'GA4';
        } else if (lowerAssetType.includes('sheet') || lowerAssetType.includes('google sheets')) {
          sourceType = 'Google Sheets';
        } else if (lowerFileName.includes('ga4') || lowerFileName.includes('google_analytics')) {
          sourceType = 'GA4';
        } else if (lowerFileName.includes('sheet') || lowerFileName.includes('google sheets')) {
          sourceType = 'Google Sheets';
        }

        normalized.attachment = {
          kind: assetContent?.data?.kind === 'file' ? 'file' : 'csv',
          name: assetContents.length > 1 ? `${assetContents.length} files` : firstName,
          mime: assetContent?.data?.mime,
          sourceType,
        };
      } else if (isLastUser && options?.lastUserMessageAttachment) {
        normalized.attachment = options.lastUserMessageAttachment;
      }
      return normalized;
    });

  return restoredMessages;
}
