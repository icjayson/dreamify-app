import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Search, LayoutGrid, Table2, PanelLeft, ChevronLeft, ChevronRight, Activity, MessageSquare, LogOut, FileText, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConversationTable } from '@/components/admin/ConversationTable';
import { ConversationCard } from '@/components/admin/ConversationCard';
import { SplitPaneChatView } from '@/components/admin/SplitPaneChatView';
import { AdminMetricsPanel } from '@/components/admin/AdminMetricsPanel';
import { UserBaseTable, type UserSortConfig, type UserSortField } from '@/components/admin/UserBaseTable';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { adminService, type ConversationListItem } from '@/services/adminService';
import { Card, CardContent } from '@/components/ui/card';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ViewMode = 'table' | 'card' | 'split';
const PAGE_SIZE = 20;
const USER_PAGE_SIZE = 50;

export default function AdminPage() {
  const { isAdmin, userEmail, getToken, signOut } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [projectIdFilter, setProjectIdFilter] = useState(searchParams.get('project_id') || '');
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10));
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [userHasDashboard, setUserHasDashboard] = useState('all');
  const [userHasWorkspace, setUserHasWorkspace] = useState('all');
  const [userHasConnector, setUserHasConnector] = useState('all');
  const [userSortConfig, setUserSortConfig] = useState<UserSortConfig | null>({
    field: 'signup_date',
    direction: 'desc',
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-conversations', projectIdFilter, currentPage],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return adminService.listConversations(
        token,
        projectIdFilter || undefined,
        currentPage,
        PAGE_SIZE
      );
    },
    enabled: isAdmin,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const activeTab =
    location.pathname === '/admin/users'
      ? 'users'
      : location.pathname === '/admin/chat-logs'
        ? 'chat-logs'
        : 'analytics';

  const { data: usersData, isLoading: isLoadingUsers, error: usersError, refetch: refetchUsers } = useQuery({
    queryKey: [
      'admin-users',
      userSearch,
      userPage,
      userHasDashboard,
      userHasWorkspace,
      userHasConnector,
      userSortConfig?.field,
      userSortConfig?.direction,
    ],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return adminService.listUsers(token, {
        page: userPage,
        pageSize: USER_PAGE_SIZE,
        query: userSearch,
        hasDashboard: userHasDashboard === 'all' ? undefined : userHasDashboard === 'true',
        hasWorkspace: userHasWorkspace === 'all' ? undefined : userHasWorkspace === 'true',
        hasConnector: userHasConnector === 'all' ? undefined : userHasConnector === 'true',
        sortBy: userSortConfig?.field,
        sortDir: userSortConfig?.direction,
      });
    },
    enabled: isAdmin,
  });

  const handleUserSort = (field: UserSortField) => {
    setUserSortConfig((prev) => {
      if (prev?.field === field) {
        if (prev.direction === 'asc') {
          return { field, direction: 'desc' };
        }
        return null;
      }
      return { field, direction: 'asc' };
    });
    setUserPage(1);
  };

  const userTotalPages = usersData ? Math.ceil(usersData.total / USER_PAGE_SIZE) : 0;

  const handleProjectIdSearch = (value: string) => {
    setProjectIdFilter(value);
    setCurrentPage(1);
    if (value) {
      setSearchParams({ project_id: value, page: '1' });
    } else {
      setSearchParams({ page: '1' });
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('page', page.toString());
    setSearchParams(newParams);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Access control (signed-in + admin) is enforced by the <AdminRoute> wrapper
  // in App.tsx, so this component can assume an authenticated admin.

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <main className="flex-1 p-6 h-[calc(100vh)] overflow-y-auto">
        {/* Header */}
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

        {/* Tabs Navigation */}
        <Tabs
          value={activeTab}
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

          <TabsContent value="analytics" className="space-y-6">
            {/* Metrics Panel */}
            <AdminMetricsPanel />
          </TabsContent>

          <TabsContent value="users" className="space-y-6">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative max-w-lg flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by uid, email, name, connector..."
                  value={userSearch}
                  onChange={(event) => {
                    setUserSearch(event.target.value);
                    setUserPage(1);
                  }}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={userHasDashboard}
                  onChange={(event) => {
                    setUserHasDashboard(event.target.value);
                    setUserPage(1);
                  }}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">All dashboards</option>
                  <option value="true">Has dashboard</option>
                  <option value="false">No dashboard</option>
                </select>
                <select
                  value={userHasWorkspace}
                  onChange={(event) => {
                    setUserHasWorkspace(event.target.value);
                    setUserPage(1);
                  }}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">All workspaces</option>
                  <option value="true">Has workspace</option>
                  <option value="false">No workspace</option>
                </select>
                <select
                  value={userHasConnector}
                  onChange={(event) => {
                    setUserHasConnector(event.target.value);
                    setUserPage(1);
                  }}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">All connectors</option>
                  <option value="true">Has connector</option>
                  <option value="false">No connector</option>
                </select>
                <select
                  value={userSortConfig?.field || 'default'}
                  onChange={(event) => {
                    const value = event.target.value;
                    setUserSortConfig(value === 'default' ? null : { field: value as UserSortField, direction: 'desc' });
                    setUserPage(1);
                  }}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="default">Default sort</option>
                  <option value="signup_date">Signup date</option>
                  <option value="latest_signin_date">Latest signin</option>
                  <option value="token_burned">Tokens burned</option>
                  <option value="dashboard_count">Dashboards</option>
                  <option value="project_count">Projects</option>
                  <option value="file_upload_count">Files</option>
                  <option value="connector_count">Connectors</option>
                  <option value="workspace_count">Workspaces</option>
                </select>
              </div>
            </div>

            {isLoadingUsers && (
              <Card>
                <CardContent className="p-6 text-center">
                  <p>Loading users...</p>
                </CardContent>
              </Card>
            )}

            {usersError && (
              <Card>
                <CardContent className="p-6">
                  <p className="text-destructive">Error loading users: {usersError instanceof Error ? usersError.message : 'Unknown error'}</p>
                  <Button onClick={() => refetchUsers()} className="mt-4">
                    Retry
                  </Button>
                </CardContent>
              </Card>
            )}

            {usersData && !isLoadingUsers && !usersError && (
              <>
                <div className="text-sm text-muted-foreground">
                  Showing {usersData.total === 0 ? 0 : ((userPage - 1) * USER_PAGE_SIZE) + 1} to {Math.min(userPage * USER_PAGE_SIZE, usersData.total)} of {usersData.total} users
                </div>
                <UserBaseTable
                  users={usersData.users}
                  sortConfig={userSortConfig}
                  onSort={handleUserSort}
                />
                {userTotalPages > 1 && (
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setUserPage((page) => Math.max(1, page - 1))}
                      disabled={userPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {userPage} of {userTotalPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setUserPage((page) => Math.min(userTotalPages, page + 1))}
                      disabled={userPage >= userTotalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="chat-logs" className="space-y-6">
            {/* Filters and Controls */}
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter by Project ID..."
                  value={projectIdFilter}
                  onChange={(e) => handleProjectIdSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === 'split' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('split')}
                >
                  <PanelLeft className="h-4 w-4 mr-2" />
                  Split
                </Button>
                <Button
                  variant={viewMode === 'table' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('table')}
                >
                  <Table2 className="h-4 w-4 mr-2" />
                  Table
                </Button>
                <Button
                  variant={viewMode === 'card' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('card')}
                >
                  <LayoutGrid className="h-4 w-4 mr-2" />
                  Cards
                </Button>
              </div>
            </div>

            {/* Content */}
            {isLoading && (
              <Card>
                <CardContent className="p-6 text-center">
                  <p>Loading conversations...</p>
                </CardContent>
              </Card>
            )}

            {error && (
              <Card>
                <CardContent className="p-6">
                  <p className="text-destructive">Error loading conversations: {error instanceof Error ? error.message : 'Unknown error'}</p>
                  <Button onClick={() => refetch()} className="mt-4">
                    Retry
                  </Button>
                </CardContent>
              </Card>
            )}

            {data && !isLoading && !error && (
              <>
                <div className="mb-4 text-sm text-muted-foreground">
                  Showing {((currentPage - 1) * PAGE_SIZE) + 1} to {Math.min(currentPage * PAGE_SIZE, data.total)} of {data.total} conversations
                </div>

                {viewMode === 'split' ? (
                  <SplitPaneChatView conversations={data.conversations} projectIdFilter={projectIdFilter} />
                ) : viewMode === 'table' ? (
                  <ConversationTable conversations={data.conversations} />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {data.conversations.map((conv) => (
                      <ConversationCard key={conv.conversation_id} conversation={conv} />
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-6">
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (currentPage > 1) {
                                handlePageChange(currentPage - 1);
                              }
                            }}
                            disabled={currentPage === 1}
                            className="gap-1"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            Previous
                          </Button>
                        </PaginationItem>

                        {/* Page numbers */}
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                          const showPage =
                            pageNum === 1 ||
                            pageNum === totalPages ||
                            (pageNum >= currentPage - 1 && pageNum <= currentPage + 1);

                          if (!showPage) {
                            if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                              return (
                                <PaginationItem key={pageNum}>
                                  <PaginationEllipsis />
                                </PaginationItem>
                              );
                            }
                            return null;
                          }

                          return (
                            <PaginationItem key={pageNum}>
                              <Button
                                variant={currentPage === pageNum ? 'outline' : 'ghost'}
                                size="sm"
                                onClick={() => handlePageChange(pageNum)}
                                className="min-w-[2.5rem]"
                              >
                                {pageNum}
                              </Button>
                            </PaginationItem>
                          );
                        })}

                        <PaginationItem>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (currentPage < totalPages) {
                                handlePageChange(currentPage + 1);
                              }
                            }}
                            disabled={currentPage === totalPages}
                            className="gap-1"
                          >
                            Next
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
