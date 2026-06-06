export interface ComparisonRow {
  dimension: string;
  competitor: string;
  dreamify: string;
}

export interface ComparisonContent {
  slug: string;
  competitor: string;
  title: string;
  description: string;
  tldr: ComparisonRow[];
  scenario: { title: string; body: string };
  competitorPros: string[];
  dreamifyWins: { title: string; body: string }[];
  pricing: { competitor: string; dreamify: string };
  migrationNotes?: string;
}
