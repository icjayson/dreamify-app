import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Code, MessageSquare, Settings, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface ConversationNodesViewProps {
  nodes: Array<Record<string, any>>;
}

export function ConversationNodesView({ nodes }: ConversationNodesViewProps) {
  const getRoleIcon = (role: string) => {
    switch (role?.toLowerCase()) {
      case 'user':
        return <User className="h-4 w-4" />;
      case 'assistant':
        return <MessageSquare className="h-4 w-4" />;
      case 'system':
        return <Settings className="h-4 w-4" />;
      default:
        return <MessageSquare className="h-4 w-4" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role?.toLowerCase()) {
      case 'user':
        return 'bg-blue-500/10 border-blue-500/20';
      case 'assistant':
        return 'bg-green-500/10 border-green-500/20';
      case 'system':
        return 'bg-purple-500/10 border-purple-500/20';
      default:
        return 'bg-gray-500/10 border-gray-500/20';
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  const renderContent = (contents: Array<any>) => {
    if (!contents || contents.length === 0) return <span className="text-muted-foreground italic">No content</span>;
    
    return contents.map((content, idx) => {
      if (content.type === 'text') {
        return (
          <div key={idx} className="whitespace-pre-wrap text-sm">
            {content.data?.text || ''}
          </div>
        );
      } else if (content.type === 'dashboard') {
        return (
          <div key={idx} className="text-sm text-muted-foreground">
            Dashboard: {content.data?.dashboard_id || 'N/A'}
          </div>
        );
      } else if (content.type === 'asset' || content.type === 'attachment') {
        return (
          <div key={idx} className="text-sm text-muted-foreground">
            Asset: {content.data?.filename || content.data?.name || 'N/A'}
          </div>
        );
      }
      return null;
    });
  };

  const renderToolCalls = (metadata: Record<string, any>) => {
    if (!metadata?.tool_calls || metadata.tool_calls.length === 0) return null;

    return (
      <div className="mt-2 space-y-2">
        {metadata.tool_calls.map((toolCall: any, idx: number) => (
          <Card key={idx} className="bg-muted/50 border-l-4 border-l-orange-500">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Code className="h-3 w-3 text-orange-500" />
                <span className="text-xs font-semibold text-orange-500">
                  {toolCall.name}
                </span>
              </div>
              {toolCall.args && (
                <pre className="text-xs bg-background p-2 rounded overflow-x-auto">
                  {JSON.stringify(toolCall.args, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {nodes.map((node, index) => (
        <Card
          key={node.node_id || index}
          className={cn('border-l-4', getRoleColor(node.role || 'unknown'))}
        >
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value={`node-${index}`} className="border-0">
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-3 w-full">
                  <div className={cn('p-2 rounded', getRoleColor(node.role || 'unknown'))}>
                    {getRoleIcon(node.role || 'unknown')}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{node.role || 'unknown'}</span>
                      {node.status && (
                        <span className={cn(
                          'text-xs px-2 py-0.5 rounded',
                          node.status === 'completed' ? 'bg-green-500/20 text-green-500' : 'bg-yellow-500/20 text-yellow-500'
                        )}>
                          {node.status}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDate(node.created_at)}
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-3">
                  {node.contents && (
                    <div className="space-y-2">
                      {renderContent(node.contents)}
                    </div>
                  )}
                  {node.metadata && renderToolCalls(node.metadata)}
                  {node.metadata?.tool_call_id && (
                    <div className="text-xs text-muted-foreground">
                      Tool Call ID: <span className="font-mono">{node.metadata.tool_call_id}</span>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      ))}
    </div>
  );
}

