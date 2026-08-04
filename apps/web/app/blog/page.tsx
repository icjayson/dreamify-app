import type { Metadata } from "next";

import { LegacyRoute } from "../legacy-route";

export const metadata: Metadata = {
  title: {
    absolute: "Dreamify Blog — AI Data Visualization, Dashboards, and SME Analytics",
  },
  description:
    "Practical guides on AI data visualization, marketing dashboards, and analytics for SMEs without a data team.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndexPage() {
  return <LegacyRoute />;
}
