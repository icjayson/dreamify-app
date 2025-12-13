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
import { ArrowUpDown, Eye } from 'lucide-react';
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
              <TableCell className="font-mono text-xs">
                {conv.user_id.slice(0, 12)}...
              </TableCell>
              <TableCell>{conv.title}</TableCell>
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

