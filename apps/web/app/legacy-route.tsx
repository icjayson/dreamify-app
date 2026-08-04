"use client";

import dynamic from "next/dynamic";

const LegacyEntry = dynamic(() => import("@/legacy-entry"), {
  ssr: false,
  loading: () => null,
});

export function LegacyRoute() {
  return <LegacyEntry />;
}
