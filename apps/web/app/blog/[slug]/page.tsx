import type { Metadata } from "next";

import { LegacyRoute } from "../../legacy-route";
import { getPublishedBlogPost } from "@/server/blog";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedBlogPost(slug);
  if (!post) {
    return {
      title: "Blog post unavailable",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: { absolute: post.title },
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at ?? undefined,
      images: post.cover_image_url
        ? [{ url: post.cover_image_url, alt: post.cover_image_alt || post.title }]
        : undefined,
    },
  };
}

export default function BlogPostPage() {
  return <LegacyRoute />;
}
