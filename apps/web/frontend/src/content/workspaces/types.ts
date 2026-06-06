export interface WorkspaceContent {
  slug: string;
  name: string;
  title: string;
  description: string;
  hero: {
    headline: string;
    subhead: string;
  };
  capabilities: { title: string; body: string }[];
  setupSteps: string[];
  useCases: { persona: string; example: string }[];
  faqs: { q: string; a: string }[];
}
