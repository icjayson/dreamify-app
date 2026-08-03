import sanitizeHtml from "sanitize-html";

export interface BlogPostSummary {
  post_id: string;
  slug: string;
  title: string;
  description: string;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  author: string;
  persona: string | null;
  tags: string[];
  status: "published";
  reading_minutes: number;
  published_at: string | null;
  featured: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface BlogPost extends BlogPostSummary {
  content_html: string;
  content_json: Record<string, unknown> | null;
  target_keyword: string | null;
}

const ALLOWED_TAGS = [
  "a",
  "aside",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "figcaption",
  "figure",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

export function sanitizeBlogHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      aside: ["data-dreamify-notice"],
      "*": ["id"],
      img: ["src", "alt", "title", "width", "height", "loading"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          rel: "noopener noreferrer",
        },
      }),
      img: (_tagName, attributes) => ({
        tagName: "img",
        attribs: {
          ...attributes,
          loading: attributes.loading === "eager" ? "eager" : "lazy",
        },
      }),
    },
  });
}

function apiBaseUrl(): string | null {
  const raw = process.env.DREAMIFY_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function publicApi<T>(path: string): Promise<T | null> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return null;
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function listPublishedBlogPosts(): Promise<BlogPostSummary[] | null> {
  return publicApi<BlogPostSummary[]>("/api/v1/blog/posts");
}

export async function getPublishedBlogPost(slug: string): Promise<BlogPost | null> {
  return publicApi<BlogPost>(`/api/v1/blog/posts/${encodeURIComponent(slug)}`);
}
