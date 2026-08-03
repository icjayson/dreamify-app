import { useNavigate } from '@/lib/navigation';
import { Eye, CheckCircle2, XCircle, Copy, Check, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminUserListItem } from '@/services/adminService';
import { formatToDisplay } from '@/utils/timestamp';

interface UserBaseTableProps {
  users: AdminUserListItem[];
  sortConfig?: UserSortConfig | null;
  onSort?: (field: UserSortField) => void;
}

export type UserSortField =
  | 'uid'
  | 'mail'
  | 'name'
  | 'has_dashboard'
  | 'workspace_platform'
  | 'has_workspace'
  | 'has_connector'
  | 'dashboard_count'
  | 'project_count'
  | 'file_upload_count'
  | 'connector_count'
  | 'connected_connectors'
  | 'connector_entity_count'
  | 'workspace_count'
  | 'connected_workspaces'
  | 'token_burned'
  | 'signup_date'
  | 'latest_signin_date';

export interface UserSortConfig {
  field: UserSortField;
  direction: 'asc' | 'desc';
}

const shortId = (value: string) => value.length > 14 ? `${value.slice(0, 14)}...` : value;

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  try {
    return formatToDisplay(value, { format: 'date' });
  } catch {
    return value;
  }
};

const BoolIcon = ({ value }: { value: boolean }) => (
  <span className={value ? 'text-emerald-600' : 'text-muted-foreground'}>
    {value ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
  </span>
);

const copyToClipboard = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.left = '-999999px';
  textarea.style.top = '-999999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};

export function UserBaseTable({ users, sortConfig, onSort }: UserBaseTableProps) {
  const navigate = useNavigate();
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  const openUser = (uid: string, section?: string) => {
    navigate(`/admin/users/${encodeURIComponent(uid)}${section ? `?section=${section}` : ''}`);
  };

  const CountButton = ({
    uid,
    section,
    value,
  }: {
    uid: string;
    section: string;
    value: number;
  }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 font-mono text-xs"
      onClick={(event) => {
        event.stopPropagation();
        openUser(uid, section);
      }}
    >
      {value.toLocaleString()}
    </Button>
  );

  const CopyableText = ({
    value,
    display,
    className,
  }: {
    value: string;
    display?: string;
    className?: string;
  }) => (
    <div className="group inline-flex max-w-full items-center gap-1.5">
      <span className={className} title={value}>{display || value}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        title="Copy"
        onClick={async (event) => {
          event.stopPropagation();
          await copyToClipboard(value);
          setCopiedValue(value);
          window.setTimeout(() => setCopiedValue((current) => current === value ? null : current), 1200);
        }}
      >
        {copiedValue === value ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );

  const getSortIcon = (field: UserSortField) => {
    if (!sortConfig || sortConfig.field !== field) {
      return <ArrowUpDown className="ml-2 h-3 w-3 opacity-50" />;
    }
    return sortConfig.direction === 'asc' ? (
      <ArrowUp className="ml-2 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-2 h-3 w-3" />
    );
  };

  const SortHeader = ({ field, label }: { field: UserSortField; label: string }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 -ml-3 px-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      onClick={() => onSort?.(field)}
    >
      <span className="whitespace-normal text-left leading-tight">{label}</span>
      {getSortIcon(field)}
    </Button>
  );

  return (
    <div className="rounded-md border bg-background overflow-x-auto">
      <Table className="min-w-[1800px]">
        <TableHeader>
          <TableRow>
            <TableHead><SortHeader field="uid" label="UID" /></TableHead>
            <TableHead><SortHeader field="mail" label="Mail" /></TableHead>
            <TableHead><SortHeader field="name" label="Name" /></TableHead>
            <TableHead><SortHeader field="has_dashboard" label="Has Dashboard" /></TableHead>
            <TableHead><SortHeader field="workspace_platform" label="Workspace Platform" /></TableHead>
            <TableHead><SortHeader field="has_workspace" label="Has Workspace" /></TableHead>
            <TableHead><SortHeader field="has_connector" label="Has Connector" /></TableHead>
            <TableHead><SortHeader field="dashboard_count" label="Dashboards" /></TableHead>
            <TableHead><SortHeader field="project_count" label="Projects" /></TableHead>
            <TableHead><SortHeader field="file_upload_count" label="Files" /></TableHead>
            <TableHead><SortHeader field="connector_count" label="Connectors" /></TableHead>
            <TableHead><SortHeader field="connected_connectors" label="Connected Connectors" /></TableHead>
            <TableHead><SortHeader field="connector_entity_count" label="Entities" /></TableHead>
            <TableHead><SortHeader field="workspace_count" label="Workspaces" /></TableHead>
            <TableHead><SortHeader field="connected_workspaces" label="Connected Workspaces" /></TableHead>
            <TableHead><SortHeader field="token_burned" label="Tokens Burned" /></TableHead>
            <TableHead><SortHeader field="signup_date" label="Signup Date" /></TableHead>
            <TableHead><SortHeader field="latest_signin_date" label="Latest Signin" /></TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow
              key={user.uid}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => openUser(user.uid)}
            >
              <TableCell className="font-mono text-xs">
                <CopyableText value={user.uid} display={shortId(user.uid)} />
              </TableCell>
              <TableCell className="max-w-[220px]">
                {user.mail ? (
                  <CopyableText value={user.mail} className="block max-w-[190px] truncate" />
                ) : '-'}
              </TableCell>
              <TableCell className="max-w-[180px] truncate font-medium">{user.name || '-'}</TableCell>
              <TableCell><BoolIcon value={user.has_dashboard} /></TableCell>
              <TableCell>
                {user.workspace_platform ? (
                  <div className="flex flex-wrap gap-1">
                    {user.workspace_platforms.map((platform) => (
                      <Badge key={platform} variant="outline" className="text-xs">{platform}</Badge>
                    ))}
                  </div>
                ) : '-'}
              </TableCell>
              <TableCell><BoolIcon value={user.has_workspace} /></TableCell>
              <TableCell><BoolIcon value={user.has_connector} /></TableCell>
              <TableCell><CountButton uid={user.uid} section="dashboards" value={user.dashboard_count} /></TableCell>
              <TableCell><CountButton uid={user.uid} section="projects" value={user.project_count} /></TableCell>
              <TableCell><CountButton uid={user.uid} section="files" value={user.file_upload_count} /></TableCell>
              <TableCell><CountButton uid={user.uid} section="connectors" value={user.connector_count} /></TableCell>
              <TableCell className="max-w-[240px]">
                <div className="flex flex-wrap gap-1">
                  {user.connected_connectors.length ? user.connected_connectors.slice(0, 4).map((name) => (
                    <Badge key={name} variant="secondary" className="text-xs">{name}</Badge>
                  )) : '-'}
                  {user.connected_connectors.length > 4 && (
                    <Badge variant="outline" className="text-xs">+{user.connected_connectors.length - 4}</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell><CountButton uid={user.uid} section="entities" value={user.connector_entity_count} /></TableCell>
              <TableCell><CountButton uid={user.uid} section="workspaces" value={user.workspace_count} /></TableCell>
              <TableCell className="max-w-[240px] truncate" title={user.connected_workspaces.join(', ')}>
                {user.connected_workspaces.length ? user.connected_workspaces.join(', ') : '-'}
              </TableCell>
              <TableCell className="font-mono text-xs">{user.token_burned.toLocaleString()}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{formatDate(user.signup_date)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{formatDate(user.latest_signin_date)}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    openUser(user.uid);
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
