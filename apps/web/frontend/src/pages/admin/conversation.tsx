import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Code, FileText, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ConversationNodesView } from '@/components/admin/ConversationNodesView';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { adminService } from '@/services/adminService';
import { useState } from 'react';
import { PanelLeft } from 'lucide-react';

export default function AdminConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project_id') || '';
  const navigate = useNavigate();
  const { credentials } = useAdminAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { data: conversationData, isLoading: isLoadingConversation } = useQuery({
    queryKey: ['admin-conversation', conversationId, projectId],
    queryFn: async () => {
      if (!credentials || !conversationId) throw new Error('Missing credentials or conversation ID');
      return adminService.getConversation(credentials.username, credentials.password, conversationId, projectId);
    },
    enabled: !!credentials && !!conversationId && !!projectId,
  });

  const { data: nodesData, isLoading: isLoadingNodes } = useQuery({
    queryKey: ['admin-conversation-nodes', conversationId, projectId],
    queryFn: async () => {
      if (!credentials || !conversationId) throw new Error('Missing credentials or conversation ID');
      return adminService.getConversationNodes(credentials.username, credentials.password, conversationId, projectId);
    },
    enabled: !!credentials && !!conversationId && !!projectId,
  });

  const conversation = conversationData?.conversation;

  return (
    <div className="min-h-screen bg-muted">
      <div
        className="grid"
        style={{ gridTemplateColumns: `${sidebarCollapsed ? '4rem' : '16rem'} 1fr` }}
      >
        <AdminSidebar
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
        
        <main className="p-6 h-[calc(100vh)] overflow-y-auto">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <button
                type="button"
                className="p-1.5 rounded-md hover:bg-background transition-colors"
                onClick={() => setSidebarCollapsed((v) => !v)}
              >
                <PanelLeft className="w-5 h-5" />
              </button>
              <div className="h-4 w-px bg-border mx-1" />
              <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
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
                        const nodes = conversation.nodes || [];
                        const assets: any[] = [];
                        for (const node of nodes) {
                          const contents = node?.contents || [];
                          for (const content of contents) {
                            if (content?.type === 'asset' || content?.type === 'attachment') {
                              const assetData = content?.data || {};
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
                                  {asset.asset_id} ({asset.filename || 'N/A'})
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null;
                      })()}
                      <div>
                        <span className="font-medium">Created:</span>
                        <span className="ml-2">
                          {new Date(conversation.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="font-medium">Updated:</span>
                        <span className="ml-2">
                          {new Date(conversation.updated_at).toLocaleString()}
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
                    <CardTitle>Full Conversation JSON</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-muted p-4 rounded overflow-x-auto max-h-[600px] overflow-y-auto">
                      {JSON.stringify(conversation, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </main>
      </div>
    </div>
  );
}

