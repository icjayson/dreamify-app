export interface BlogSection {
  heading: string;
  paragraphs: string[];
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  targetKeyword: string;
  persona: string;
  publishedAt: string;
  updatedAt: string;
  author: string;
  sections: BlogSection[];
}
