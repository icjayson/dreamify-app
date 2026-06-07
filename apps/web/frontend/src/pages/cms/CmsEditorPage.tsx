import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImagePlus, Loader2, Save, Trash2, ExternalLink, Eye, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { slugify } from "@/utils/slugify";
import RichTextEditor from "@/components/cms/RichTextEditor";
import BlogContent from "@/components/blog/BlogContent";
import { cmsService, type BlogPostUpsert } from "@/services/cmsService";

const estimateReadingMinutes = (html: string): number => {
  const words = html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
};

interface FormState {
  title: string;
  slug: string;
  description: string;
  tags: string;
  target_keyword: string;
  cover_image_url: string;
  cover_image_alt: string;
  author: string;
  content_html: string;
  content_json: Record<string, unknown> | null;
  status: "draft" | "published";
}

const EMPTY: FormState = {
  title: "", slug: "", description: "", tags: "",
  target_keyword: "", cover_image_url: "", cover_image_alt: "", author: "Dreamify Team",
  content_html: "", content_json: null, status: "draft",
};

export default function CmsEditorPage() {
  const { postId } = useParams<{ postId: string }>();
  const isEdit = !!postId && postId !== "new";
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin } = useAdminAuth();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0); // remount editor once content loads
  const slugEditedRef = useRef(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["cms-post", postId],
    queryFn: () => cmsService.get(postId!),
    enabled: isAdmin && isEdit,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        title: existing.title,
        slug: existing.slug,
        description: existing.description,
        tags: (existing.tags ?? []).join(", "),
        target_keyword: existing.target_keyword ?? "",
        cover_image_url: existing.cover_image_url ?? "",
        cover_image_alt: existing.cover_image_alt ?? "",
        author: existing.author ?? "Dreamify Team",
        content_html: existing.content_html,
        content_json: existing.content_json,
        status: existing.status,
      });
      slugEditedRef.current = true;
      setEditorKey((k) => k + 1);
    }
  }, [existing]);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const onTitleChange = (title: string) => {
    update({ title, ...(slugEditedRef.current ? {} : { slug: slugify(title) }) });
  };

  const buildPayload = (status: "draft" | "published"): BlogPostUpsert => ({
    slug: form.slug || undefined,
    title: form.title.trim(),
    description: form.description.trim(),
    content_html: form.content_html,
    content_json: form.content_json,
    cover_image_url: form.cover_image_url || null,
    cover_image_alt: form.cover_image_alt.trim(),
    author: form.author.trim() || "Dreamify Team",
    persona: null,
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    target_keyword: form.target_keyword.trim() || null,
    status,
  });

  const saveMutation = useMutation({
    mutationFn: (status: "draft" | "published") => {
      const payload = buildPayload(status);
      return isEdit ? cmsService.update(postId!, payload) : cmsService.create(payload);
    },
    onSuccess: (saved) => {
      toast({ title: isEdit ? "Post saved" : "Post created" });
      queryClient.invalidateQueries({ queryKey: ["cms-posts"] });
      queryClient.invalidateQueries({ queryKey: ["blog-posts"] });
      queryClient.invalidateQueries({ queryKey: ["blog-post", saved.slug] });
      if (!isEdit) navigate(`/admin/cms/${saved.post_id}`);
    },
    onError: (e) => toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => cmsService.remove(postId!),
    onSuccess: () => {
      toast({ title: "Post deleted" });
      queryClient.invalidateQueries({ queryKey: ["cms-posts"] });
      queryClient.invalidateQueries({ queryKey: ["blog-posts"] });
      navigate("/admin/cms");
    },
    onError: (e) => toast({ title: "Delete failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });

  const handleCoverPick = () => coverInputRef.current?.click();
  const handleCoverSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingCover(true);
    try {
      const url = await cmsService.uploadImage(file);
      update({ cover_image_url: url });
    } catch (err) {
      toast({ title: "Cover upload failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setUploadingCover(false);
    }
  };

  const canSave = form.title.trim().length > 0 && !saveMutation.isPending;

  if (isEdit && isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted">
      {/* Sticky action bar */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/cms")} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            {isEdit && form.status === "published" && (
              <Button variant="ghost" size="sm" asChild className="gap-1.5">
                <a href={`/blog/${form.slug}`} target="_blank" rel="noopener noreferrer">
                  View <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
            {isEdit && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (window.confirm("Delete this post? This cannot be undone.")) deleteMutation.mutate();
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} className="gap-2">
              <Eye className="h-4 w-4" />
              Preview
            </Button>
            <Button variant="outline" size="sm" disabled={!canSave} onClick={() => saveMutation.mutate("draft")} className="gap-2">
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save draft
            </Button>
            <Button size="sm" disabled={!canSave} onClick={() => saveMutation.mutate("published")} className="gap-2">
              {form.status === "published" ? "Update" : "Publish"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-semibold">{isEdit ? "Edit post" : "New post"}</h1>

        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          {/* Main column */}
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={form.title} onChange={(e) => onTitleChange(e.target.value)} placeholder="How to build a dashboard in 5 minutes" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description / excerpt</Label>
              <Textarea id="description" value={form.description} rows={2} onChange={(e) => update({ description: e.target.value })} placeholder="One or two sentences shown on the blog index and in search results." />
            </div>

            <div className="space-y-2">
              <Label>Body</Label>
              <RichTextEditor
                key={editorKey}
                content={form.content_html}
                onChange={(html, json) => setForm((f) => ({ ...f, content_html: html, content_json: json }))}
              />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-background p-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => { slugEditedRef.current = true; update({ slug: slugify(e.target.value) }); }}
                  placeholder="auto-from-title"
                />
                <p className="text-xs text-muted-foreground">/blog/{form.slug || "…"}</p>
              </div>

              <div className="space-y-2">
                <Label>Cover image</Label>
                {form.cover_image_url ? (
                  <div className="overflow-hidden rounded-md border border-border">
                    <img src={form.cover_image_url} alt="cover" className="aspect-[16/9] w-full object-cover" />
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-2" disabled={uploadingCover} onClick={handleCoverPick}>
                    {uploadingCover ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    {form.cover_image_url ? "Replace" : "Upload"}
                  </Button>
                  {form.cover_image_url && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => update({ cover_image_url: "" })}>Remove</Button>
                  )}
                </div>
                <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={handleCoverSelected} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cover-alt">Cover alt text</Label>
                <Input
                  id="cover-alt"
                  value={form.cover_image_alt}
                  onChange={(e) => update({ cover_image_alt: e.target.value })}
                  placeholder="Describe the cover image"
                />
                <p className="text-xs text-muted-foreground">Used for SEO & screen readers. Falls back to the title if empty.</p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background p-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="author">Author</Label>
                <Input id="author" value={form.author} onChange={(e) => update({ author: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Tags (comma-separated)</Label>
                <Input id="tags" value={form.tags} onChange={(e) => update({ tags: e.target.value })} placeholder="dashboards, analytics" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="keyword">Target keywords (SEO)</Label>
                <Input id="keyword" value={form.target_keyword} onChange={(e) => update({ target_keyword: e.target.value })} placeholder="marketing dashboard, no-code analytics, sme reporting" />
                <p className="text-xs text-muted-foreground">Separate multiple keywords with commas. Remember to include 'dashboard, AI data visualization, AI data analytics, data AI' and other keywords if needed</p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-background p-4">
              <div>
                <Label className="text-sm">Published</Label>
                <p className="text-xs text-muted-foreground">{form.status === "published" ? "Visible on /blog" : "Hidden draft"}</p>
              </div>
              <Switch checked={form.status === "published"} onCheckedChange={(v) => update({ status: v ? "published" : "draft" })} />
            </div>
          </div>
        </div>
      </div>

      {/* Full-screen preview overlay — renders the post exactly as it appears on
          /blog (reuses BlogContent + the hero markup from BlogPost). */}
      {previewOpen && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-background">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
            <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Eye className="h-4 w-4 text-primary" />
              Preview — how this looks on /blog
            </span>
            <Button variant="ghost" size="sm" onClick={() => setPreviewOpen(false)} className="gap-2">
              <X className="h-4 w-4" />
              Close
            </Button>
          </div>

          <article className="px-5 pb-16 pt-10 sm:px-8">
            <div className="mx-auto max-w-3xl">
              {(() => {
                const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
                return tags.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {tags.map((t) => (
                      <Badge key={t} variant="outline">{t}</Badge>
                    ))}
                  </div>
                ) : null;
              })()}

              <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
                {form.title || "Untitled post"}
              </h1>
              {form.description && (
                <p className="mt-4 text-lg leading-8 text-muted-foreground">{form.description}</p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{form.author || "Dreamify Team"}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {estimateReadingMinutes(form.content_html)} min read
                </span>
              </div>

              {form.cover_image_url && (
                <div className="mt-8 overflow-hidden rounded-2xl border border-border/60">
                  <img src={form.cover_image_url} alt={form.cover_image_alt || form.title} className="aspect-[16/9] w-full object-cover" />
                </div>
              )}

              <div className="mt-10">
                {form.content_html ? (
                  <BlogContent html={form.content_html} />
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing in the body yet.</p>
                )}
              </div>
            </div>
          </article>
        </div>
      )}
    </div>
  );
}
