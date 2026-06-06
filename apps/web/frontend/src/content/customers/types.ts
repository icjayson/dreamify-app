export interface CustomerCaseStudy {
  slug: string;
  customerName: string;
  industry: string;
  size: string;
  region: string;
  persona: string;
  title: string;
  description: string;
  featuredMetric: { label: string; value: string };
  challenge: string;
  solution: string;
  outcomes: { label: string; value: string }[];
  quote?: { text: string; name: string; role: string };
  /** When true, the case study renders a "Coming soon" placeholder rather than full content. */
  placeholder?: boolean;
}
