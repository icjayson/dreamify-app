"use client";

import dynamic from "next/dynamic";

const LegacyEntry = dynamic(() => import("@/legacy-entry"), {
  ssr: false,
  loading: () => (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
        Loading Dreamify…
      </div>
    </main>
  ),
});

export function LegacyRoute() {
  return <LegacyEntry />;
}
