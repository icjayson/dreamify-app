import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, Eye, LayoutTemplate } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ConversationListItem } from '@/services/adminService';

interface ConversationTableProps {
  conversations: ConversationListItem[];
}

type SortField = 'conversation_id' | 'project_id' | 'user_id' | 'title' | 'created_at' | 'updated_at';
type SortDirection = 'asc' | 'desc';

export function ConversationTable({ conversations }: ConversationTableProps) {
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedConversations = [...conversations].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 -ml-3"
                onClick={() => handleSort('conversation_id')}
              >
                ID
                <ArrowUpDown className="ml-2 h-3 w-3" />
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 -ml-3"
                onClick={() => handleSort('project_id')}
              >
                Project ID
                <ArrowUpDown className="ml-2 h-3 w-3" />
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 -ml-3"
                onClick={() => handleSort('user_id')}
              >
                User ID
                <ArrowUpDown className="ml-2 h-3 w-3" />
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 -ml-3"
                onClick={() => handleSort('title')}
              >
                Title
                <ArrowUpDown className="ml-2 h-3 w-3" />
              </Button>
            </TableHead>
            <TableHead>Template</TableHead>
            <TableHead>Environment</TableHead>
            <TableHead>Tokens</TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 -ml-3"
                onClick={() => handleSort('created_at')}
              >
                Created At
                <ArrowUpDown className="ml-2 h-3 w-3" />
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 -ml-3"
                onClick={() => handleSort('updated_at')}
              >
                Updated At
                <ArrowUpDown className="ml-2 h-3 w-3" />
              </Button>
            </TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedConversations.map((conv) => (
            <TableRow
              key={conv.conversation_id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => navigate(`/admin/conversation/${conv.conversation_id}?project_id=${conv.project_id}`)}
            >
              <TableCell className="font-mono text-xs">
                {conv.conversation_id.slice(0, 8)}...
              </TableCell>
              <TableCell className="font-mono text-xs">
                {conv.project_id.slice(0, 8)}...
              </TableCell>
              <TableCell>
                {conv.user_name ? (
                  <div className="flex items-center gap-2">
                    {conv.user_avatar ? (
                      <img src={conv.user_avatar} alt={conv.user_name} className="h-5 w-5 rounded-full object-cover" />
                    ) : (
                      <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground border">
                        {conv.user_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="text-sm font-medium">{conv.user_name}</span>
                  </div>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">{conv.user_id.slice(0, 12)}...</span>
                )}
              </TableCell>
              <TableCell>{conv.title}</TableCell>
              <TableCell>
                {conv.template_id ? (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                    <LayoutTemplate className="h-3 w-3" />
                    <span className="truncate max-w-[100px]">{conv.template_id}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs italic">none</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1 items-start">
                  {conv.chat_mode ? (
                    <span className="text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded uppercase">
                      {conv.chat_mode}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">-</span>
                  )}
                  {conv.model && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={conv.model}>
                      {conv.model}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {conv.total_tokens ? (
                  <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded border">
                    {conv.total_tokens.toLocaleString()}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">-</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(conv.created_at)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(conv.updated_at)}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/admin/conversation/${conv.conversation_id}?project_id=${conv.project_id}`);
                  }}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

