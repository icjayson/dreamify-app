import { api } from "@/services/api";
import { API_ENDPOINTS } from "@/api/config";

export interface BlogPostSummary {
  post_id: string;
  slug: string;
  title: string;
  description: string;
  cover_image_url: string | null;
  author: string;
  persona: string | null;
  tags: string[];
  status: "draft" | "published";
  reading_minutes: number;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface BlogPost extends BlogPostSummary {
  content_html: string;
  content_json: Record<string, unknown> | null;
  target_keyword: string | null;
}

export const blogService = {
  /** Published posts, newest-first. Public. */
  async listPosts(): Promise<BlogPostSummary[]> {
    const res = await api.get<BlogPostSummary[]>(API_ENDPOINTS.BLOG_POSTS);
    if (!res.success) throw new Error(res.error || "Failed to load posts");
    return res.data || [];
  },

  /** A single published post by slug. Public. Returns null on 404. */
  async getPost(slug: string): Promise<BlogPost | null> {
    const res = await api.get<BlogPost>(`${API_ENDPOINTS.BLOG_POSTS}/${encodeURIComponent(slug)}`);
    if (!res.success) return null;
    return res.data || null;
  },
};
