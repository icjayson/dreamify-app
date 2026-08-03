export interface SeoProps {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
  ogImageAlt?: string;
  ogType?: "website" | "article";
  twitterSite?: string;
  jsonLd?: object | object[];
  noindex?: boolean;
}

/**
 * Compatibility marker for imported pages.
 *
 * Metadata is emitted by the App Router's server-side `generateMetadata`.
 * Keeping this no-op component lets the migrated page bodies retain their
 * descriptive source data without mutating `<head>` from a client-only tree.
 */
export const Seo = (props: SeoProps) => {
  void props;
  return null;
};

export default Seo;
