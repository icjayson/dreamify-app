import type { BlogPost } from "./types";
import marketingDashboard from "./marketing-dashboard-in-5-minutes";
import multiChannel from "./multi-channel-ad-dashboard";
import killingFriday from "./spreadsheet-reporting-killing-friday";
import aiVsBi from "./ai-data-visualization-vs-bi";
import smeNoData from "./sme-dashboard-without-data-team";
import dashboardsInSlack from "./dashboards-in-slack";
import tiktokReporting from "./tiktok-ads-reporting-2026";
import costOfManual from "./cost-of-manual-reporting";

export const POSTS: BlogPost[] = [
  marketingDashboard,
  multiChannel,
  killingFriday,
  aiVsBi,
  smeNoData,
  dashboardsInSlack,
  tiktokReporting,
  costOfManual,
];

export const getPost = (slug: string): BlogPost | undefined =>
  POSTS.find((p) => p.slug === slug);

export type { BlogPost };
