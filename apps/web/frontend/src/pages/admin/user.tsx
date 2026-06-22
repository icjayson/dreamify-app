import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, Database, FileText, FolderKanban, Gauge, Link2, LogOut, MessageSquare, Plug, Table2, User, Users, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminDashboardPreview } from '@/components/admin/AdminDashboardPreview';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { adminService, type AdminUserDashboardItem, type AdminUserProjectItem } from '@/services/adminService';
import { formatToDisplay } from '@/utils/timestamp';

type DetailItem = {
  title: string;
  data: unknown;
  dashboard?: AdminUserDashboardItem;
  project?: AdminUserProjectItem;
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  try {
    return formatToDisplay(value, { format: 'full' });
  } catch {
    return value;
  }
};

const Metric = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-md border bg-background p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-semibold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
  </div>
);

const JsonBlock = ({ data }: { data: unknown }) => (
  <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted p-4 text-xs">
    {JSON.stringify(data, null, 2)}
  </pre>
);

export default function AdminUserPage() {
  const { userId } = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { getToken, isAdmin, userEmail, signOut } = useAdminAuth();
  const [selected, setSelected] = useState<DetailItem | null>(null);

  const defaultTab = searchParams.get('section') || 'overview';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-user-detail', userId],
    queryFn: async () => {
      if (!userId) throw new Error('Missing user ID');
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return adminService.getUserDetail(token, userId);
    },
    enabled: isAdmin && !!userId,
  });

  const user = data?.user;

  const prettyUserJson = useMemo(() => {
    if (!data) return {};
    return {
      user: data.user,
      projects: data.projects,
      dashboards: data.dashboards,
      files: data.files,
      connectors: data.connectors,
      entities: data.entities,
      workspaces: data.workspaces,
      conversations: data.conversations,
    };
  }, [data]);

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <main className="flex-1 p-6 h-[calc(100vh)] overflow-y-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/cms')} className="gap-2">
              <FileText className="h-4 w-4" />
              Blog CMS
            </Button>
            <span className="text-sm text-muted-foreground mr-2">
              Logged in as <span className="font-medium text-foreground">{userEmail}</span>
            </span>
            <Button variant="outline" size="sm" onClick={() => signOut()} className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10">
              <LogOut className="h-4 w-4" />
              Log Out
            </Button>
          </div>
        </div>

        <Tabs
          value="users"
          onValueChange={(value) => {
            if (value === 'analytics') navigate('/admin/analytics');
            if (value === 'users') navigate('/admin/users');
            if (value === 'chat-logs') navigate('/admin/chat-logs');
          }}
          className="space-y-6"
        >
          <TabsList>
            <TabsTrigger value="analytics" className="gap-2">
              <Activity className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="chat-logs" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Chat Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/admin/users')} className="mb-4 -ml-2 gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Users
              </Button>
              <h2 className="text-2xl font-semibold">User Details</h2>
              {user && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {user.mail || user.name || user.uid} · <span className="font-mono">{user.uid}</span>
                </p>
              )}
            </div>

            {isLoading && (
              <Card>
                <CardContent className="p-6 text-center">Loading user...</CardContent>
              </Card>
            )}

            {error && (
              <Card>
                <CardContent className="p-6">
                  <p className="text-destructive">
                    Error loading user: {error instanceof Error ? error.message : 'Unknown error'}
                  </p>
                  <Button onClick={() => refetch()} className="mt-4">Retry</Button>
                </CardContent>
              </Card>
            )}

            {data && user && (
            <Tabs defaultValue={defaultTab} className="space-y-4">
              <TabsList className="flex h-auto flex-wrap justify-start">
                <TabsTrigger value="overview" className="gap-2"><User className="h-4 w-4" />Overview</TabsTrigger>
                <TabsTrigger value="dashboards" className="gap-2"><Gauge className="h-4 w-4" />Dashboards ({data.dashboards.length})</TabsTrigger>
                <TabsTrigger value="projects" className="gap-2"><FolderKanban className="h-4 w-4" />Projects ({data.projects.length})</TabsTrigger>
                <TabsTrigger value="files" className="gap-2"><Table2 className="h-4 w-4" />Files ({data.files.length})</TabsTrigger>
                <TabsTrigger value="connectors" className="gap-2"><Plug className="h-4 w-4" />Connectors ({data.connectors.length})</TabsTrigger>
                <TabsTrigger value="entities" className="gap-2"><Database className="h-4 w-4" />Entities ({data.entities.length})</TabsTrigger>
                <TabsTrigger value="workspaces" className="gap-2"><Workflow className="h-4 w-4" />Workspaces ({data.workspaces.length})</TabsTrigger>
                <TabsTrigger value="json" className="gap-2"><Link2 className="h-4 w-4" />JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Metric label="Dashboards" value={user.dashboard_count} />
                  <Metric label="Projects" value={user.project_count} />
                  <Metric label="Files Uploaded" value={user.file_upload_count} />
                  <Metric label="Connector Entities" value={user.connector_entity_count} />
                  <Metric label="Tokens Burned" value={user.token_burned} />
                </div>
                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle>Profile</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                    <div><span className="font-medium">UID:</span> <span className="font-mono text-xs">{user.uid}</span></div>
                    <div><span className="font-medium">Email:</span> {user.mail || '-'}</div>
                    <div><span className="font-medium">Name:</span> {user.name || '-'}</div>
                    <div><span className="font-medium">Workspace platforms:</span> {user.workspace_platform || '-'}</div>
                    <div><span className="font-medium">Signup:</span> {formatDate(user.signup_date)}</div>
                    <div><span className="font-medium">Latest signin:</span> {formatDate(user.latest_signin_date)}</div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="dashboards">
                <div className="grid gap-3">
                  {data.dashboards.map((item) => (
                    <Card key={`${item.project_id}-${item.dashboard_id}`} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected({ title: item.title || item.dashboard_id, data: item, dashboard: item })}>
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div>
                          <p className="font-medium">{item.title || 'Untitled dashboard'}</p>
                          <p className="font-mono text-xs text-muted-foreground">{item.dashboard_id}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <p>{formatDate(item.created_at)}</p>
                          <p className="font-mono">{item.project_id.slice(0, 8)}...</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="projects">
                <div className="grid gap-3">
                  {data.projects.map((item) => (
                    <Card key={item.project_id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected({ title: item.name || item.project_id, data: item, project: item })}>
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div>
                          <p className="font-medium">{item.name || 'Untitled Project'}</p>
                          <p className="font-mono text-xs text-muted-foreground">{item.project_id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.latest_dashboard_id && <Badge variant="secondary">dashboard</Badge>}
                          <span className="text-xs text-muted-foreground">{formatDate(item.updated_at || item.created_at)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="files">
                <div className="grid gap-3">
                  {data.files.map((item) => (
                    <Card key={item.asset_id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected({ title: item.filename || item.asset_id, data: item })}>
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div>
                          <p className="font-medium">{item.filename || 'Untitled file'}</p>
                          <p className="font-mono text-xs text-muted-foreground">{item.asset_id}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <p>{item.extension || item.asset_type}</p>
                          <p>{formatDate(item.created_at)}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="connectors">
                <div className="grid gap-3">
                  {data.connectors.map((item) => (
                    <Card key={item.provider} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected({ title: item.display_name, data: item })}>
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div>
                          <p className="font-medium">{item.display_name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{item.provider}</p>
                        </div>
                        <Badge variant={item.connected ? 'secondary' : 'outline'}>{item.entity_count} entities</Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="entities">
                <div className="grid gap-3">
                  {data.entities.map((item, index) => (
                    <Card key={`${item.provider}-${item.id}-${index}`} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected({ title: item.name || item.id, data: item })}>
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div>
                          <p className="font-medium">{item.name || item.id}</p>
                          <p className="font-mono text-xs text-muted-foreground">{item.id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{item.display_name}</Badge>
                          {item.type && <Badge variant="outline">{item.type}</Badge>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="workspaces">
                <div className="grid gap-3">
                  {data.workspaces.map((item) => (
                    <Card key={item.platform_workspace_id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected({ title: item.workspace_name || item.platform_workspace_id, data: item })}>
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div>
                          <p className="font-medium">{item.workspace_name || item.platform_workspace_id}</p>
                          <p className="font-mono text-xs text-muted-foreground">{item.platform_workspace_id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{item.platform}</Badge>
                          <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="json">
                <JsonBlock data={prettyUserJson} />
              </TabsContent>
            </Tabs>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
          </DialogHeader>
          {selected?.dashboard?.conversation_id && (
            <div className="mb-4 min-h-[420px] rounded-md border">
              <AdminDashboardPreview
                conversationId={selected.dashboard.conversation_id}
                projectId={selected.dashboard.project_id}
                dashboardId={selected.dashboard.dashboard_id}
              />
            </div>
          )}
          {selected?.data && <JsonBlock data={selected.data} />}
          {selected?.dashboard?.conversation_id && (
            <Button
              className="mt-2"
              variant="outline"
              onClick={() => navigate(`/admin/conversation/${selected.dashboard?.conversation_id}?project_id=${selected.dashboard?.project_id}`)}
            >
              Open Chat Log
            </Button>
          )}
          {selected?.project?.latest_conversation_id && (
            <Button
              className="mt-2"
              variant="outline"
              onClick={() => navigate(`/admin/conversation/${selected.project?.latest_conversation_id}?project_id=${selected.project?.project_id}`)}
            >
              Open Chat Log
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
