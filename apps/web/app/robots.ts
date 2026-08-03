import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dreamify-web.vercel.app";
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/workspace", "/admin", "/preview", "/templates", "/feedback", "/sso-callback", "/zalo-upload", "/login", "/signup"] },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
