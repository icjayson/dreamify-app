import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Eye, Calendar, User, Folder, LayoutTemplate } from 'lucide-react';
import { useNavigate } from '@/lib/navigation';
import type { ConversationListItem } from '@/services/adminService';
import { formatToDisplay } from '@/utils/timestamp';

interface ConversationCardProps {
  conversation: ConversationListItem;
}

export function ConversationCard({ conversation }: ConversationCardProps) {
  const navigate = useNavigate();

  const formatDate = (dateString: string) => {
    try {
      return formatToDisplay(dateString, { format: 'full' });
    } catch {
      return dateString;
    }
  };

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => navigate(`/admin/conversation/${conversation.conversation_id}?project_id=${conversation.project_id}`)}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">{conversation.title}</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/admin/conversation/${conversation.conversation_id}?project_id=${conversation.project_id}`);
            }}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Folder className="h-3 w-3" />
            <span className="font-mono text-xs truncate">{conversation.project_id}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            {conversation.user_avatar ? (
              <img src={conversation.user_avatar} alt={conversation.user_name || 'User'} className="h-4 w-4 rounded-full object-cover" />
            ) : (
              <User className="h-4 w-4" />
            )}
            <span className="text-xs truncate">
              {conversation.user_name || <span className="font-mono">{conversation.user_id}</span>}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span className="text-xs">{formatDate(conversation.created_at)}</span>
          </div>
        </div>
        <div className="pt-2 border-t flex flex-col gap-2">
          <div className="flex flex-wrap gap-2 items-center">
            {conversation.chat_mode && (
              <span className="text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded uppercase">
                {conversation.chat_mode}
              </span>
            )}
            {(conversation.theme_id || conversation.analysis_focus_id || conversation.template_id) && (
              <span className="text-[10px] font-medium bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded flex items-center gap-1">
                <LayoutTemplate className="h-2.5 w-2.5" />
                {conversation.theme_id || conversation.template_id}
                {conversation.analysis_focus_id ? ` / ${conversation.analysis_focus_id}` : ''}
              </span>
            )}
            {conversation.model && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={conversation.model}>
                {conversation.model}
              </span>
            )}
            {conversation.total_tokens ? (
              <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded border ml-auto">
                {conversation.total_tokens.toLocaleString()} tkns
              </span>
            ) : null}
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">
            ID: {conversation.conversation_id.slice(0, 16)}...
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
