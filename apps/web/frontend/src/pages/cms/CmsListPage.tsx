import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, Trash2, LogOut, FileText, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { cmsService } from "@/services/cmsService";
import type { BlogPostSummary } from "@/services/blogService";

const formatDate = (value: string | null): string => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

type SortOption = "latest" | "oldest" | "az";
type StatusFilter = "all" | "published" | "draft";

const SORT_OPTIONS: [SortOption, string][] = [["latest", "Latest"], ["oldest", "Oldest"], ["az", "A–Z"]];
const STATUS_OPTIONS: [StatusFilter, string][] = [["all", "All"], ["published", "Published"], ["draft", "Draft"]];

const postTime = (p: BlogPostSummary): number => {
  const v = p.published_at || p.created_at;
  const t = v ? Date.parse(v) : 0;
  return Number.isNaN(t) ? 0 : t;
};

const sortPosts = (posts: BlogPostSummary[], by: SortOption): BlogPostSummary[] => {
  const arr = [...posts];
  if (by === "az") return arr.sort((a, b) => a.title.localeCompare(b.title));
  if (by === "oldest") return arr.sort((a, b) => postTime(a) - postTime(b));
  return arr.sort((a, b) => postTime(b) - postTime(a));
};

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-background p-0.5">
      {options.map(([val, label]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
            value === val ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

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

  const featureMutation = useMutation({
    mutationFn: (postId: string) => cmsService.setFeatured(postId),
    onSuccess: () => {
      toast({ title: "Featured post updated" });
      queryClient.invalidateQueries({ queryKey: ["cms-posts"] });
      queryClient.invalidateQueries({ queryKey: ["blog-posts"] });
    },
    onError: (e) => toast({ title: "Failed to set featured", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });

  const handleDelete = (post: BlogPostSummary) => {
    if (window.confirm(`Delete "${post.title}"? This cannot be undone.`)) {
      deleteMutation.mutate(post.post_id);
    }
  };

  const [sortBy, setSortBy] = useState<SortOption>("latest");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const posts = data ?? [];
  const visible = sortPosts(
    statusFilter === "all" ? posts : posts.filter((p) => p.status === statusFilter),
    sortBy,
  );

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

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {visible.length === posts.length ? `${posts.length} posts` : `${visible.length} of ${posts.length} posts`}
            </p>
            <Segmented value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">Sort</span>
            <Segmented value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
            <Button onClick={() => navigate("/admin/cms/new")} className="gap-2">
              <Plus className="h-4 w-4" />
              New post
            </Button>
          </div>
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
                      <TableHead className="w-36 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                          No posts match this filter.
                        </TableCell>
                      </TableRow>
                    ) : visible.map((post) => (
                      <TableRow key={post.post_id} className="cursor-pointer" onClick={() => navigate(`/admin/cms/${post.post_id}`)}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{post.title}</span>
                            {post.featured && <Badge variant="secondary" className="gap-1"><Star className="h-3 w-3 fill-primary text-primary" />Featured</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">/{post.slug}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={post.status === "published" ? "default" : "secondary"}>{post.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(post.published_at)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{post.reading_minutes} min</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title={post.featured ? "Featured on /blog" : "Set as featured on /blog"}
                              disabled={featureMutation.isPending}
                              onClick={() => featureMutation.mutate(post.post_id)}
                            >
                              <Star className={cn("h-4 w-4", post.featured ? "fill-primary text-primary" : "text-muted-foreground")} />
                            </Button>
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
