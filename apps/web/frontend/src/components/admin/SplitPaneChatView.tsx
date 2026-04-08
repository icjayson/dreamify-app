import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { MessageSquare, LayoutTemplate, Activity, FileText, Code, Copy, Info, PanelLeftClose, PanelRightClose, PanelRight, PanelLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type ConversationListItem } from '@/services/adminService';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { adminService } from '@/services/adminService';
import { ChatTimelineNodesView } from './ChatTimelineNodesView';
import { useToast } from '@/hooks/use-toast';

interface SplitPaneChatViewProps {
    conversations: ConversationListItem[];
    projectIdFilter?: string;
}

export function SplitPaneChatView({ conversations, projectIdFilter }: SplitPaneChatViewProps) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isLeftPaneOpen, setIsLeftPaneOpen] = useState(true);
    const [isRightPaneOpen, setIsRightPaneOpen] = useState(false);

    const { getToken, isAdmin } = useAdminAuth();
    const { toast } = useToast();

    const selectedConvMeta = useMemo(() => {
        return conversations.find((c) => c.conversation_id === selectedId);
    }, [conversations, selectedId]);

    const { data: conversationData, isLoading: isLoadingConversation } = useQuery({
        queryKey: ['admin-conversation', selectedId, selectedConvMeta?.project_id],
        queryFn: async () => {
            if (!selectedId || !selectedConvMeta?.project_id) {
                throw new Error('Missing ids');
            }
            const token = await getToken();
            if (!token) throw new Error('Not authenticated');
            return adminService.getConversation(
                token,
                selectedId,
                selectedConvMeta.project_id
            );
        },
        enabled: isAdmin && !!selectedId && !!selectedConvMeta?.project_id,
    });

    const { data: nodesData, isLoading: isLoadingNodes } = useQuery({
        queryKey: ['admin-conversation-nodes', selectedId, selectedConvMeta?.project_id],
        queryFn: async () => {
            if (!selectedId || !selectedConvMeta?.project_id) {
                throw new Error('Missing ids');
            }
            const token = await getToken();
            if (!token) throw new Error('Not authenticated');
            return adminService.getConversationNodes(
                token,
                selectedId,
                selectedConvMeta.project_id
            );
        },
        enabled: isAdmin && !!selectedId && !!selectedConvMeta?.project_id,
    });

    const conversationJsonString = useMemo(() => {
        if (!conversationData?.conversation) return '';
        return JSON.stringify(conversationData.conversation, null, 2);
    }, [conversationData]);

    const handleCopyJson = async () => {
        if (!conversationJsonString) return;
        try {
            await navigator.clipboard.writeText(conversationJsonString);
            toast({ title: "Copied JSON", description: "JSON copied to clipboard." });
        } catch (err) {
            toast({ title: "Error", description: "Failed to copy JSON.", variant: "destructive" });
        }
    };

    return (
        <div className="flex w-full h-[calc(100vh-250px)] border rounded-lg bg-background overflow-hidden relative">
            {/* LEFT COLUMN: Master List */}
            {isLeftPaneOpen && (
                <div className="w-[30%] min-w-[300px] border-r flex flex-col bg-muted/20 shrink-0">
                    <div className="p-4 border-b font-medium text-sm flex items-center justify-between bg-muted/40 shrink-0">
                        <div className="flex items-center gap-2">
                            <span>Conversations</span>
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                {conversations.length}
                            </span>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsLeftPaneOpen(false)}>
                            <PanelLeftClose className="h-4 w-4" />
                        </Button>
                    </div>
                    <ScrollArea className="flex-1">
                        <div className="flex flex-col p-2 space-y-1">
                            {conversations.map((conv) => (
                                <button
                                    key={conv.conversation_id}
                                    onClick={() => setSelectedId(conv.conversation_id)}
                                    className={cn(
                                        "flex items-center gap-3 p-3 rounded-md text-left transition-colors",
                                        selectedId === conv.conversation_id
                                            ? "bg-primary/10 hover:bg-primary/15"
                                            : "hover:bg-muted"
                                    )}
                                >
                                    {/* Avatar Placeholder or Real Avatar */}
                                    <div className={cn(
                                        "flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center bg-muted text-muted-foreground overflow-hidden border",
                                        selectedId === conv.conversation_id && !conv.user_avatar ? "bg-primary/20 text-primary border-primary/30" : ""
                                    )}>
                                        {conv.user_avatar ? (
                                            <img src={conv.user_avatar} alt={conv.user_name || "User"} className="h-full w-full object-cover" />
                                        ) : conv.user_name ? (
                                            <span className="text-xs font-bold leading-none">
                                                {conv.user_name.charAt(0).toUpperCase()}
                                            </span>
                                        ) : (
                                            <MessageSquare className="h-5 w-5 opacity-70" />
                                        )}
                                    </div>

                                    {/* Thread Info */}
                                    <div className="flex-1 min-w-0 overflow-hidden pr-2">
                                        <div className={cn(
                                            "font-medium text-sm truncate",
                                            !conv.user_name && "text-muted-foreground/80 font-mono text-[11px]"
                                        )}>
                                            {conv.user_name || (conv.user_id.startsWith('user_') ? conv.user_id.replace('user_', 'ID: ') : conv.user_id) || 'Unknown User'}
                                        </div>
                                        <div className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                                            <LayoutTemplate className="h-3 w-3" />
                                            {conv.project_id.split('-')[0]}
                                        </div>
                                    </div>

                                    {/* Timestamp & Metrics */}
                                    <div className="flex flex-col items-end gap-1 ml-auto mt-1 shrink-0">
                                        <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                                            {new Date(conv.created_at).toLocaleDateString(undefined, {
                                                month: 'short',
                                                day: 'numeric'
                                            })}
                                        </div>
                                        {conv.chat_mode && (
                                            <span className="text-[8px] font-semibold bg-primary/10 text-primary px-1 rounded uppercase">
                                                {conv.chat_mode}
                                            </span>
                                        )}
                                        {conv.total_tokens ? (
                                            <span className="text-[8px] font-mono text-muted-foreground bg-muted px-1 rounded">
                                                {conv.total_tokens >= 1000 ? `${(conv.total_tokens / 1000).toFixed(1)}k` : conv.total_tokens} t
                                            </span>
                                        ) : null}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </ScrollArea>
                </div>
            )}

            {/* CENTER COLUMN: Detail View (Timeline Default) */}
            <div className="flex-1 min-w-0 bg-background flex flex-col overflow-hidden relative">
                {!selectedId ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 relative">
                        {/* Toggle Buttons overlay if panes are closed */}
                        <div className="absolute top-4 left-4 right-4 flex justify-between">
                            {!isLeftPaneOpen && (
                                <Button variant="outline" size="icon" onClick={() => setIsLeftPaneOpen(true)}>
                                    <PanelLeft className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4 mt-8">
                            <MessageSquare className="h-8 w-8 opacity-50" />
                        </div>
                        <p className="text-lg font-medium">No conversation selected</p>
                        <p className="text-sm opacity-70 mt-1">Select a conversation to view the timeline</p>
                    </div>
                ) : (
                    <div className="flex flex-col h-full w-full">
                        {/* Center Header */}
                        <div className="p-4 border-b flex items-center justify-between shadow-sm bg-background z-10 shrink-0">
                            <div className="flex items-center gap-3 overflow-hidden min-w-0 pr-4">
                                {!isLeftPaneOpen && (
                                    <Button variant="ghost" size="icon" onClick={() => setIsLeftPaneOpen(true)} className="shrink-0">
                                        <PanelLeft className="h-5 w-5" />
                                    </Button>
                                )}
                                <div className="min-w-0">
                                    <h3 className="font-semibold text-lg flex items-center gap-2 truncate">
                                        <MessageSquare className="h-5 w-5 text-primary shrink-0" />
                                        <span className="truncate">{selectedConvMeta?.title || 'Conversation'}</span>
                                    </h3>
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                                        <span className="truncate">ID: {selectedId}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setIsRightPaneOpen(!isRightPaneOpen)}
                                    className={cn("gap-2", isRightPaneOpen && "bg-muted")}
                                >
                                    {isRightPaneOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
                                    <span className="hidden sm:inline">Details</span>
                                </Button>
                            </div>
                        </div>

                        {/* Center Content: Timeline Only */}
                        <div className="flex-1 overflow-auto bg-muted/5 relative p-0 md:p-4">
                            {(isLoadingConversation || isLoadingNodes) ? (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                                </div>
                            ) : nodesData?.nodes ? (
                                <ChatTimelineNodesView
                                    nodes={nodesData.nodes}
                                    conversationId={selectedId}
                                    projectId={selectedConvMeta?.project_id}
                                />
                            ) : (
                                <div className="text-center p-8 text-muted-foreground border rounded bg-background m-4">
                                    No nodes found for this conversation.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* RIGHT COLUMN: Overview & JSON */}
            {isRightPaneOpen && selectedId && (
                <div className="w-[30%] min-w-[300px] border-l bg-muted/10 shrink-0 flex flex-col h-full overflow-hidden">
                    <div className="flex-1 overflow-hidden flex flex-col pt-4">
                        <Tabs defaultValue="overview" className="w-full h-full flex flex-col px-4 pb-4">
                            <TabsList className="grid w-full grid-cols-2 mb-4 shrink-0">
                                <TabsTrigger value="overview" className="flex items-center gap-2 text-xs">
                                    <Info className="h-3 w-3" /> Info
                                </TabsTrigger>
                                <TabsTrigger value="json" className="flex items-center gap-2 text-xs">
                                    <Code className="h-3 w-3" /> JSON
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="overview" className="flex-1 overflow-auto outline-none mx-0">
                                <Card className="border-none shadow-none bg-transparent">
                                    <CardHeader className="p-0 pb-4">
                                        <CardTitle className="text-sm flex items-center gap-2">
                                            <FileText className="h-4 w-4" /> Metadata
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4 p-0">
                                        <div className="flex flex-col gap-4">
                                            <div>
                                                <div className="text-xs font-medium text-muted-foreground mb-1">User</div>
                                                <div className="font-mono text-[11px] bg-muted/50 p-2 rounded truncate" title={selectedConvMeta?.user_id}>
                                                    {selectedConvMeta?.user_name ? (
                                                        <div className="flex items-center justify-between gap-2 overflow-hidden">
                                                            <span className="font-medium text-primary truncate max-w-[150px]">{selectedConvMeta.user_name}</span>
                                                            <span className="opacity-50 whitespace-nowrap text-[10px]">({selectedConvMeta.user_id.slice(0, 12)}...)</span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2 text-muted-foreground italic">
                                                            <span className="truncate">{selectedConvMeta?.user_id}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-xs font-medium text-muted-foreground mb-1">Project</div>
                                                <div className="font-mono text-xs bg-muted/50 p-2 rounded truncate" title={selectedConvMeta?.project_id}>
                                                    {selectedConvMeta?.project_id}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-xs font-medium text-muted-foreground mb-1">Created At</div>
                                                <div className="text-xs bg-muted/50 p-2 rounded">
                                                    {selectedConvMeta?.created_at ? new Date(selectedConvMeta.created_at).toLocaleString() : 'N/A'}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-xs font-medium text-muted-foreground mb-1">S3 Bucket</div>
                                                <div className="text-xs bg-muted/50 p-2 rounded">{selectedConvMeta?.s3_bucket || 'N/A'}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs font-medium text-muted-foreground mb-1">S3 Key</div>
                                                <div className="font-mono text-[10px] bg-muted/50 p-2 rounded break-all">
                                                    {selectedConvMeta?.s3_key || 'N/A'}
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            <TabsContent value="json" className="flex-1 overflow-hidden outline-none h-full flex flex-col mx-0">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-semibold">Raw Data</span>
                                    <Button variant="outline" size="icon" className="h-6 w-6" onClick={handleCopyJson} title="Copy JSON">
                                        <Copy className="h-3 w-3" />
                                    </Button>
                                </div>
                                <div className="flex-1 relative rounded-md border bg-muted/30">
                                    <ScrollArea className="absolute inset-0">
                                        <pre className="p-3 text-[10px] font-mono whitespace-pre-wrap">
                                            {conversationJsonString || 'No JSON available'}
                                        </pre>
                                    </ScrollArea>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>
            )}
        </div>
    );
}
