import { api, apiClient } from "@/services/api";
import { API_ENDPOINTS } from "@/api/config";
import type { BlogPost, BlogPostSummary } from "@/services/blogService";

export interface BlogPostUpsert {
  slug?: string;
  title: string;
  description: string;
  content_html: string;
  content_json?: Record<string, unknown> | null;
  cover_image_url?: string | null;
  cover_image_alt?: string | null;
  author: string;
  persona?: string | null;
  tags: string[];
  target_keyword?: string | null;
  status: "draft" | "published";
}

interface AssetUploadResponse {
  asset_id: string;
  url: string;
}

/** Turn a backend-relative asset path into a URL that resolves from any page origin. */
const toAbsoluteAssetUrl = (relativeUrl: string): string => {
  const base = apiClient.getBaseUrl();
  if (!base) return relativeUrl; // dev: same-origin proxy
  return `${base.replace(/\/$/, "")}${relativeUrl}`;
};

export const cmsService = {
  /** All posts incl. drafts, newest-first. Admin only. */
  async listAll(): Promise<BlogPostSummary[]> {
    const res = await api.get<BlogPostSummary[]>(API_ENDPOINTS.CMS_POSTS);
    if (!res.success) throw new Error(res.error || "Failed to load posts");
    return res.data || [];
  },

  async get(postId: string): Promise<BlogPost> {
    const res = await api.get<BlogPost>(`${API_ENDPOINTS.CMS_POSTS}/${postId}`);
    if (!res.success || !res.data) throw new Error(res.error || "Failed to load post");
    return res.data;
  },

  async create(payload: BlogPostUpsert): Promise<BlogPost> {
    const res = await api.post<BlogPost>(API_ENDPOINTS.CMS_POSTS, payload);
    if (!res.success || !res.data) throw new Error(res.error || "Failed to create post");
    return res.data;
  },

  async update(postId: string, payload: BlogPostUpsert): Promise<BlogPost> {
    const res = await api.patch<BlogPost>(`${API_ENDPOINTS.CMS_POSTS}/${postId}`, payload);
    if (!res.success || !res.data) throw new Error(res.error || "Failed to update post");
    return res.data;
  },

  async remove(postId: string): Promise<void> {
    const res = await api.delete(`${API_ENDPOINTS.CMS_POSTS}/${postId}`);
    if (!res.success) throw new Error(res.error || "Failed to delete post");
  },

  /** Mark this post as the single featured post shown in the /blog hero. */
  async setFeatured(postId: string): Promise<BlogPost> {
    const res = await api.patch<BlogPost>(`${API_ENDPOINTS.CMS_POSTS}/${postId}/feature`);
    if (!res.success || !res.data) throw new Error(res.error || "Failed to set featured");
    return res.data;
  },

  /** Upload an image, returning a stable absolute URL for use as an <img> src. */
  async uploadImage(file: File): Promise<string> {
    const res = await api.uploadFile<AssetUploadResponse>(API_ENDPOINTS.CMS_ASSETS, file);
    if (!res.success || !res.data) throw new Error(res.error || "Failed to upload image");
    return toAbsoluteAssetUrl(res.data.url);
  },
};
