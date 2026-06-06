import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, Trash2, LogOut, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { cmsService } from "@/services/cmsService";
import type { BlogPostSummary } from "@/services/blogService";

const formatDate = (value: string | null): string => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

export default function CmsListPage() {
  const { isAdmin, userEmail, signOut } = useAdminAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["cms-posts"],
    queryFn: () => cmsService.listAll(),
    enabled: isAdmin,
  });

  const deleteMutation = useMutation({
    mutationFn: (postId: string) => cmsService.remove(postId),
    onSuccess: () => {
      toast({ title: "Post deleted" });
      queryClient.invalidateQueries({ queryKey: ["cms-posts"] });
      queryClient.invalidateQueries({ queryKey: ["blog-posts"] });
    },
    onError: (e) => toast({ title: "Delete failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });

  const handleDelete = (post: BlogPostSummary) => {
    if (window.confirm(`Delete "${post.title}"? This cannot be undone.`)) {
      deleteMutation.mutate(post.post_id);
    }
  };

  const posts = data ?? [];

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <main className="flex-1 p-6 overflow-y-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Admin
            </Button>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <FileText className="h-5 w-5" />
              Blog CMS
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="mr-2 text-sm text-muted-foreground">
              Logged in as <span className="font-medium text-foreground">{userEmail}</span>
            </span>
            <Button variant="outline" size="sm" onClick={() => signOut()} className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive">
              <LogOut className="h-4 w-4" />
              Log Out
            </Button>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{posts.length} post{posts.length === 1 ? "" : "s"}</p>
          <Button onClick={() => navigate("/admin/cms/new")} className="gap-2">
            <Plus className="h-4 w-4" />
            New post
          </Button>
        </div>

        {isLoading && (
          <Card><CardContent className="p-6 text-center text-muted-foreground">Loading posts…</CardContent></Card>
        )}
        {error && (
          <Card><CardContent className="p-6 text-destructive">{error instanceof Error ? error.message : "Failed to load posts"}</CardContent></Card>
        )}

        {!isLoading && !error && (
          <Card>
            <CardContent className="p-0">
              {posts.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-sm font-medium">No posts yet.</p>
                  <Button onClick={() => navigate("/admin/cms/new")} className="mt-4 gap-2">
                    <Plus className="h-4 w-4" />
                    Create your first post
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-40">Published</TableHead>
                      <TableHead className="w-24">Read</TableHead>
                      <TableHead className="w-28 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {posts.map((post) => (
                      <TableRow key={post.post_id} className="cursor-pointer" onClick={() => navigate(`/admin/cms/${post.post_id}`)}>
                        <TableCell>
                          <div className="font-medium text-foreground">{post.title}</div>
                          <div className="text-xs text-muted-foreground">/{post.slug}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={post.status === "published" ? "default" : "secondary"}>{post.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(post.published_at)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{post.reading_minutes} min</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title="Edit" onClick={() => navigate(`/admin/cms/${post.post_id}`)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Delete" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDelete(post)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
