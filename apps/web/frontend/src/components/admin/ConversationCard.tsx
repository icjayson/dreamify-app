import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Eye, Calendar, User, Folder } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ConversationListItem } from '@/services/adminService';

interface ConversationCardProps {
  conversation: ConversationListItem;
}

export function ConversationCard({ conversation }: ConversationCardProps) {
  const navigate = useNavigate();

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString();
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
            <User className="h-3 w-3" />
            <span className="font-mono text-xs truncate">{conversation.user_id}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span className="text-xs">{formatDate(conversation.created_at)}</span>
          </div>
        </div>
        <div className="pt-2 border-t">
          <span className="text-xs font-mono text-muted-foreground">
            ID: {conversation.conversation_id.slice(0, 16)}...
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

