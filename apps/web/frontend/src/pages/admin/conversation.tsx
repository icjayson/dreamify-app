import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Code, Copy, FileText, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConversationNodesView } from '@/components/admin/ConversationNodesView';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { adminService } from '@/services/adminService';
import { useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { formatToDisplay } from '@/utils/timestamp';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const stringValue = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

export default function AdminConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project_id') || '';
  const navigate = useNavigate();
  const { getToken, isAdmin } = useAdminAuth();
  const { toast } = useToast();

  const { data: conversationData, isLoading: isLoadingConversation } = useQuery({
    queryKey: ['admin-conversation', conversationId, projectId],
    queryFn: async () => {
      if (!conversationId) throw new Error('Missing conversation ID');
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return adminService.getConversation(token, conversationId, projectId);
    },
    enabled: isAdmin && !!conversationId && !!projectId,
  });

  const { data: nodesData, isLoading: isLoadingNodes } = useQuery({
    queryKey: ['admin-conversation-nodes', conversationId, projectId],
    queryFn: async () => {
      if (!conversationId) throw new Error('Missing conversation ID');
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return adminService.getConversationNodes(token, conversationId, projectId);
    },
    enabled: isAdmin && !!conversationId && !!projectId,
  });

  const conversation = conversationData?.conversation;

  const conversationJsonString = useMemo(() => {
    if (!conversation) return '';
    return JSON.stringify(conversation, null, 2);
  }, [conversation]);

  const handleCopyJson = async () => {
    if (!conversationJsonString) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(conversationJsonString);
        toast({
          title: "Copied JSON",
          description: "Full conversation JSON has been copied to your clipboard.",
        });
        return;
      }
    } catch (error) {
      console.error('Clipboard API failed:', error);
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = conversationJsonString;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (successful) {
        toast({
          title: "Copied JSON",
          description: "Full conversation JSON has been copied to your clipboard.",
        });
        return;
      }
    } catch (error) {
      console.error('Fallback copy failed:', error);
    }

    toast({
      title: "Unable to copy JSON",
      description: "Your browser blocked clipboard access. Please copy manually.",
      variant: "destructive",
    });
  };

  return (
    <div className="min-h-screen bg-muted">
        <main className="p-6 h-screen overflow-y-auto">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/admin/chat-logs')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Chat Logs
              </Button>
            </div>
            <h1 className="text-2xl font-semibold">Conversation Details</h1>
            {conversation && (
              <p className="text-sm text-muted-foreground mt-1">
                ID: <span className="font-mono">{conversation.conversation_id}</span>
              </p>
            )}
          </div>

          {isLoadingConversation && (
            <Card>
              <CardContent className="p-6 text-center">
                <p>Loading conversation...</p>
              </CardContent>
            </Card>
          )}

          {conversation && (
            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">
                  <FileText className="h-4 w-4 mr-2" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="nodes">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Nodes ({nodesData?.nodes?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="json">
                  <Code className="h-4 w-4 mr-2" />
                  Full JSON
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Metadata</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div>
                        <span className="font-medium">User ID:</span>
                        <span className="ml-2 font-mono text-xs">{conversation.user_id}</span>
                      </div>
                      <div>
                        <span className="font-medium">Project ID:</span>
                        <span className="ml-2 font-mono text-xs">{conversation.project_id}</span>
                      </div>
                      <div>
                        <span className="font-medium">Conversation ID:</span>
                        <span className="ml-2 font-mono text-xs">{conversation.conversation_id}</span>
                      </div>
                      {(() => {
                        // Extract assets from nodes
                        const nodes = Array.isArray(conversation.nodes) ? conversation.nodes : [];
                        const assets: Array<Record<string, unknown>> = [];
                        for (const node of nodes) {
                          if (!isRecord(node) || !Array.isArray(node.contents)) continue;
                          const contents = node.contents;
                          for (const content of contents) {
                            if (!isRecord(content)) continue;
                            if ((content.type === 'asset' || content.type === 'attachment') && isRecord(content.data)) {
                              const assetData = content.data;
                              if (assetData.asset_id) {
                                assets.push(assetData);
                              }
                            }
                          }
                        }
                        return assets.length > 0 ? (
                          <div>
                            <span className="font-medium">Assets:</span>
                            <div className="ml-2 mt-1 space-y-1">
                              {assets.map((asset, idx) => (
                                <div key={idx} className="font-mono text-xs">
                                  {stringValue(asset.asset_id) || 'unknown'} ({stringValue(asset.filename) || 'N/A'})
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null;
                      })()}
                      <div>
                        <span className="font-medium">Created:</span>
                        <span className="ml-2">
                          {formatToDisplay(conversation.created_at, { format: 'full' })}
                        </span>
                      </div>
                      <div>
                        <span className="font-medium">Updated:</span>
                        <span className="ml-2">
                          {formatToDisplay(conversation.updated_at, { format: 'full' })}
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {conversation.metadata && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Additional Metadata</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <pre className="text-xs bg-muted p-4 rounded overflow-x-auto">
                          {JSON.stringify(conversation.metadata, null, 2)}
                        </pre>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="nodes">
                {isLoadingNodes ? (
                  <Card>
                    <CardContent className="p-6 text-center">
                      <p>Loading nodes...</p>
                    </CardContent>
                  </Card>
                ) : nodesData?.nodes ? (
                  <ConversationNodesView nodes={nodesData.nodes} />
                ) : (
                  <Card>
                    <CardContent className="p-6 text-center">
                      <p>No nodes found</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="json">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Full Conversation JSON</CardTitle>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCopyJson}
                        aria-label="Copy full conversation JSON to clipboard"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy JSON
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-muted p-4 rounded overflow-x-auto max-h-[600px] overflow-y-auto">
                      {conversationJsonString}
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </main>
    </div>
  );
}
