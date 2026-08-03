import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Bot, User, Settings, Code, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AdminDashboardPreview } from './AdminDashboardPreview';
import { AdminDatasetPreview } from './AdminDatasetPreview';
import { formatToDisplay } from '@/utils/timestamp';

interface ChatTimelineNodesViewProps {
    nodes: Array<Record<string, any>>;
    conversationId?: string;
    projectId?: string;
}

export function ChatTimelineNodesView({ nodes, conversationId, projectId }: ChatTimelineNodesViewProps) {
    const [previewDashboardId, setPreviewDashboardId] = useState<string | null>(null);
    const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);

    const renderContent = (contents: Array<any>, nodeRole?: string) => {
        if (!contents || contents.length === 0) return <span className="italic opacity-50">No content</span>;

        return contents.map((content, idx) => {
            if (content.type === 'text') {
                if (nodeRole === 'tool' && content.data?.tool_input && content.data?.tool_output) {
                    return (
                        <div key={idx} className="space-y-2 mt-2">
                            <div className="text-xs font-semibold text-orange-500 flex items-center gap-1">
                                <Code className="h-3 w-3" />
                                Tool Executed: {content.data?.tool_name || 'Unknown'}
                            </div>
                            <div className="bg-background/50 rounded p-2 border border-border/50">
                                <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Input</div>
                                <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{content.data.tool_input}</pre>
                            </div>
                            <div className="bg-background/50 rounded p-2 border border-border/50">
                                <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Output</div>
                                <pre className="text-xs overflow-x-auto max-h-[150px] whitespace-pre-wrap">{content.data.tool_output}</pre>
                            </div>
                        </div>
                    );
                }
                return (
                    <div key={idx} className="whitespace-pre-wrap text-sm leading-relaxed">
                        {content.data?.text || ''}
                    </div>
                );
            } else if (content.type === 'dashboard') {
                return (
                    <div key={idx} className="mt-2 inline-flex items-center gap-2 bg-primary/10 text-primary p-2 rounded">
                        <span className="text-xs">📊 Rendered Dashboard:</span>
                        {content.data?.dashboard_id ? (
                            <button
                                onClick={() => setPreviewDashboardId(content.data.dashboard_id)}
                                className="text-xs font-semibold hover:underline"
                            >
                                {content.data.dashboard_id}
                            </button>
                        ) : (
                            <span className="text-xs">N/A</span>
                        )}
                    </div>
                );
            } else if (content.type === 'asset' || content.type === 'attachment') {
                return (
                    <div key={idx} className="text-xs mt-2 bg-muted p-2 rounded inline-block">
                        📎 Attached:{' '}
                        {content.data?.asset_id && (content.data?.filename?.toLowerCase().endsWith('.csv') || content.data?.name?.toLowerCase().endsWith('.csv')) ? (
                            <button
                                onClick={() => setPreviewAssetId(content.data.asset_id)}
                                className="font-semibold text-primary hover:underline"
                            >
                                {content.data?.filename || content.data?.name || 'Dataset'}
                            </button>
                        ) : (
                            content.data?.filename || content.data?.name || 'N/A'
                        )}
                    </div>
                );
            }
            return null;
        });
    };

    const renderToolCalls = (metadata: Record<string, any>) => {
        if (!metadata?.tool_calls || metadata.tool_calls.length === 0) return null;

        return (
            <div className="mt-3 space-y-2">
                {metadata.tool_calls.map((toolCall: any, idx: number) => (
                    <div key={`tool-${idx}`} className="bg-orange-500/10 border border-orange-500/20 rounded-md p-2">
                        <div className="flex items-center gap-2 mb-1">
                            <Code className="h-3 w-3 text-orange-500" />
                            <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                                {toolCall.name}
                            </span>
                        </div>
                        {toolCall.args && (
                            <pre className="text-[10px] bg-background/50 p-2 rounded overflow-x-auto text-muted-foreground">
                                {JSON.stringify(toolCall.args, null, 2)}
                            </pre>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col bg-background/50 rounded-lg p-4 space-y-3">
            {nodes.map((node, index) => {
                const role = (node.role || 'unknown').toLowerCase();
                const isUser = role === 'user';
                const isSystem = role === 'system' || role === 'tool';
                const isAssistant = role === 'assistant';

                if (isSystem) {
                    return null;
                }

                return (
                    <div
                        key={node.node_id || `msg-${index}`}
                        className={cn("flex w-full gap-3", isUser ? "justify-end" : "justify-start")}
                    >
                        {!isUser && (
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 mt-1">
                                <Bot className="h-4 w-4 text-primary" />
                            </div>
                        )}

                        <div className={cn(
                            "flex flex-col max-w-[80%]",
                            isUser ? "items-end" : "items-start"
                        )}>
                            <div className="flex items-center gap-2 mb-1 px-1">
                                <span className="text-xs font-medium text-muted-foreground">
                                    {isUser ? 'User' : 'Assistant'}
                                </span>
                                <span className="text-[10px] text-muted-foreground/60">
                                    {node.created_at ? formatToDisplay(node.created_at, { format: 'time' }) : ''}
                                </span>
                            </div>

                            <div className={cn(
                                "p-3 rounded-2xl relative shadow-sm",
                                isUser
                                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                                    : "bg-muted border border-border/50 rounded-tl-sm text-foreground"
                            )}>
                                {node.contents && renderContent(node.contents, role)}
                                {node.metadata && renderToolCalls(node.metadata)}

                                {node.metadata && (
                                    <div className="mt-3 pt-2 border-t border-border/20 flex flex-wrap gap-2 text-[10px] opacity-80">
                                        {isUser && node.metadata.chat_mode && (
                                            <span className="flex items-center gap-1 bg-background/20 px-1.5 py-0.5 rounded">
                                                <Settings className="h-3 w-3" />
                                                Mode: <span className="font-semibold">{node.metadata.chat_mode}</span>
                                                {node.metadata.resolved_model && <span className="opacity-70 ml-1">({node.metadata.resolved_model})</span>}
                                            </span>
                                        )}
                                        
                                        {!isUser && node.metadata.usage && (
                                            <span className="flex items-center gap-1 bg-background/50 text-muted-foreground px-1.5 py-0.5 rounded border border-border/50">
                                                <Activity className="h-3 w-3" />
                                                Tokens: <span className="font-semibold text-foreground/80">{node.metadata.usage.total_tokens || 0}</span>
                                                <span className="opacity-70">
                                                    ({node.metadata.usage.input_tokens || 0} in, {node.metadata.usage.output_tokens || 0} out)
                                                </span>
                                            </span>
                                        )}
                                    </div>
                                )}

                                {node.metadata?.error && (
                                    <div className="mt-3 text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20">
                                        <span className="font-semibold">Error:</span> {node.metadata.error}
                                    </div>
                                )}
                            </div>
                        </div>

                        {isUser && (
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center border border-border/50 mt-1">
                                <User className="h-4 w-4 text-muted-foreground" />
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Dashboard Preview Modal */}
            <Dialog open={!!previewDashboardId} onOpenChange={(open) => !open && setPreviewDashboardId(null)}>
                <DialogContent className="max-w-[90vw] w-[1200px] h-[90vh] flex flex-col p-0 overflow-hidden">
                    <DialogHeader className="p-4 border-b shrink-0 bg-background text-foreground z-10 relative">
                        <DialogTitle>Dashboard Preview</DialogTitle>
                        <DialogDescription className="sr-only">Preview of the generated dashboard</DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto bg-muted/10 p-4 relative min-h-0">
                        {previewDashboardId && conversationId && projectId ? (
                            <AdminDashboardPreview
                                dashboardId={previewDashboardId}
                                conversationId={conversationId}
                                projectId={projectId}
                            />
                        ) : previewDashboardId ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground flex-col gap-2">
                                <p>Missing conversation or project context.</p>
                                <p className="text-xs">Cannot load the dashboard preview for {previewDashboardId}.</p>
                            </div>
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Dataset Preview Modal */}
            <Dialog open={!!previewAssetId} onOpenChange={(open) => !open && setPreviewAssetId(null)}>
                <DialogContent className="max-w-[90vw] w-[1200px] h-[90vh] flex flex-col p-4 overflow-hidden">
                    <DialogHeader className="p-0 border-b pb-4 shrink-0 bg-background text-foreground z-10 relative">
                        <DialogTitle>Dataset Preview</DialogTitle>
                        <DialogDescription className="sr-only">Preview of the uploaded dataset</DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto bg-muted/10 p-0 relative min-h-0 pt-4">
                        {previewAssetId && conversationId && projectId ? (
                            <AdminDatasetPreview
                                assetId={previewAssetId}
                                conversationId={conversationId}
                                projectId={projectId}
                            />
                        ) : previewAssetId ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground flex-col gap-2">
                                <p>Missing conversation or project context.</p>
                                <p className="text-xs">Cannot load the dataset preview for {previewAssetId}.</p>
                            </div>
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
