import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, LayoutGrid, Table2, PanelLeft, ChevronLeft, ChevronRight, Activity, MessageSquare, LogOut, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConversationTable } from '@/components/admin/ConversationTable';
import { ConversationCard } from '@/components/admin/ConversationCard';
import { SplitPaneChatView } from '@/components/admin/SplitPaneChatView';
import { AdminMetricsPanel } from '@/components/admin/AdminMetricsPanel';
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

export default function AdminPage() {
  const { isAdmin, userEmail, getToken, signOut } = useAdminAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [projectIdFilter, setProjectIdFilter] = useState(searchParams.get('project_id') || '');
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10));

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
        <Tabs defaultValue="analytics" className="space-y-6">
          <TabsList>
            <TabsTrigger value="analytics" className="gap-2">
              <Activity className="h-4 w-4" />
              Analytics
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
