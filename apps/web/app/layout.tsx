import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { assertHostedWebEnvironment } from "@/server/runtime-env";

import "@/index.css";
import "@/ui/lightswind.css";

assertHostedWebEnvironment();

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dreamify-web.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Dreamify — Private AI Analytics Preview", template: "%s | Dreamify" },
  description: "Invitation-only, non-commercial Hobby demo for turning supported data files into explainable insights and editable dashboards.",
  applicationName: "Dreamify",
  icons: { icon: "/favicon.ico", apple: "/logo-favicon.png" },
  openGraph: {
    type: "website",
    siteName: "Dreamify",
    title: "Dreamify — Private AI Analytics Preview",
    description: "Invitation-only, non-commercial Hobby demo for supported data-file analysis and editable dashboards.",
    images: ["/og-image.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og-image.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
