export interface IntegrationContent {
  slug: string;
  name: string;
  category: string;
  icon: string;
  iconBg?: string;
  title: string;
  description: string;
  hero: {
    headline: string;
    subhead: string;
  };
  metrics: string[];
  sampleDashboards: { title: string; body: string }[];
  setupSteps: string[];
  faqs: { q: string; a: string }[];
  relatedSlugs?: string[];
}
