import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Search, LayoutGrid, Table2, PanelLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ConversationTable } from '@/components/admin/ConversationTable';
import { ConversationCard } from '@/components/admin/ConversationCard';
import { AdminLoginModal } from '@/components/admin/AdminLoginModal';
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

type ViewMode = 'table' | 'card';
const PAGE_SIZE = 20;

export default function AdminPage() {
  const { isAuthenticated, credentials, login } = useAdminAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(!isAuthenticated);
  const [projectIdFilter, setProjectIdFilter] = useState(searchParams.get('project_id') || '');
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-conversations', projectIdFilter, currentPage],
    queryFn: async () => {
      if (!credentials) throw new Error('Not authenticated');
      return adminService.listConversations(
        credentials.username,
        credentials.password,
        projectIdFilter || undefined,
        currentPage,
        PAGE_SIZE
      );
    },
    enabled: isAuthenticated && !!credentials,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const handleProjectIdSearch = (value: string) => {
    setProjectIdFilter(value);
    setCurrentPage(1); // Reset to first page when filtering
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
    // Scroll to top when page changes
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!isAuthenticated) {
    return (
      <>
        <AdminLoginModal
          open={showLoginModal}
          onOpenChange={(open) => {
            setShowLoginModal(open);
            if (!open && !isAuthenticated) {
              // Redirect to home if login cancelled
              window.location.href = '/';
            }
          }}
        />
        <div className="min-h-screen flex items-center justify-center">
          <Card>
            <CardContent className="p-6">
              <p>Please log in to access the admin panel.</p>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-muted">
      <div
        className="grid"
        style={{ gridTemplateColumns: `${sidebarCollapsed ? '4rem' : '16rem'} 1fr` }}
      >
        <AdminSidebar
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
        
        <main className="p-6 h-[calc(100vh)] overflow-y-auto">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="p-1.5 rounded-md hover:bg-background transition-colors"
                  onClick={() => setSidebarCollapsed((v) => !v)}
                >
                  <PanelLeft className="w-5 h-5" />
                </button>
                <div className="h-4 w-px bg-border mx-1" />
                <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
              </div>
            </div>
          </div>

          {/* Filters and Controls */}
          <div className="mb-6 space-y-4">
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
              {viewMode === 'table' ? (
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
                        // Show first page, last page, current page, and pages around current
                        const showPage =
                          pageNum === 1 ||
                          pageNum === totalPages ||
                          (pageNum >= currentPage - 1 && pageNum <= currentPage + 1);
                        
                        if (!showPage) {
                          // Show ellipsis
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
        </main>
      </div>
    </div>
  );
}

