import type { IntegrationContent } from "./types";
import metaAds from "./meta-ads";
import googleAds from "./google-ads";
import ga4 from "./ga4";
import tiktokAds from "./tiktok-ads";
import googleSheets from "./google-sheets";
import stripe from "./stripe";
import appsflyer from "./appsflyer";
import firebase from "./firebase";
import postgresql from "./postgresql";
import bigquery from "./bigquery";
import snowflake from "./snowflake";

export const INTEGRATIONS: IntegrationContent[] = [
  metaAds,
  googleAds,
  ga4,
  tiktokAds,
  googleSheets,
  stripe,
  appsflyer,
  firebase,
  postgresql,
  bigquery,
  snowflake,
];

export const getIntegration = (slug: string): IntegrationContent | undefined =>
  INTEGRATIONS.find((i) => i.slug === slug);

export type { IntegrationContent };
