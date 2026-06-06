import { Helmet } from "react-helmet-async";

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

const DEFAULT_OG_IMAGE = "https://app.dreamify.dev/og-image.png";
const DEFAULT_TWITTER_SITE = "@dreamify_dev";

export const Seo = ({
  title,
  description,
  canonical,
  ogImage = DEFAULT_OG_IMAGE,
  ogImageAlt = "Dreamify dashboard sample",
  ogType = "website",
  twitterSite = DEFAULT_TWITTER_SITE,
  jsonLd,
  noindex,
}: SeoProps) => {
  const ldArray = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      {/* Open Graph */}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content="Dreamify" />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={ogImageAlt} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={twitterSite} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      <meta name="twitter:image:alt" content={ogImageAlt} />

      {/* JSON-LD */}
      {ldArray.map((ld, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(ld)}
        </script>
      ))}
    </Helmet>
  );
};

export default Seo;
