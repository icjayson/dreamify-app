import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { LegacyRoute } from "../legacy-route";
import {
  STATIC_ROUTE_PATHS,
  isKnownRoute,
  isNoIndexRoute,
  redirectForRoute,
  routeFromSegments,
  routeMetadata,
} from "@/lib/route-manifest";

export function generateStaticParams() {
  return STATIC_ROUTE_PATHS
    .filter((route) => route !== "blog")
    .map((route) => ({ slug: route ? route.split("/") : [] }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const route = routeFromSegments((await params).slug);
  if (!isKnownRoute(route)) return {};
  const metadata = routeMetadata(route);
  const canonical = `/${route}`;
  return {
    title: metadata.title,
    description: metadata.description,
    alternates: { canonical },
    robots: isNoIndexRoute(route) ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: "Dreamify",
      title: metadata.title,
      description: metadata.description,
      url: canonical,
      images: [{ url: "/og-image.png", alt: "Dreamify dashboard preview" }],
    },
    twitter: {
      card: "summary_large_image",
      title: metadata.title,
      description: metadata.description,
      images: ["/og-image.png"],
    },
  };
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const route = routeFromSegments((await params).slug);
  const destination = redirectForRoute(route);
  if (destination) redirect(destination);
  if (!isKnownRoute(route)) notFound();
  return <LegacyRoute />;
}
