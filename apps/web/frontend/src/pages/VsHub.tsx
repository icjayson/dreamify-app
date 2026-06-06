import { Link } from "react-router-dom";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";
import { COMPARISONS } from "@/content/vs";

const VsHub = () => (
  <>
    <Seo
      title="Dreamify vs Alternatives — Honest Comparisons"
      description="See how Dreamify compares to Julius AI, Looker Studio, Power BI, Airbook, Omni, Tableau, and ChatGPT for data analysis."
      canonical="https://app.dreamify.dev/vs"
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Dreamify Comparisons",
        url: "https://app.dreamify.dev/vs",
        isPartOf: { "@id": "https://app.dreamify.dev/#website" },
      }}
    />
    <MarketingShell>
      <h1>What's different about Dreamify</h1>
      <p>Honest, side-by-side comparisons with the tools you're probably evaluating against.</p>
      <ul>
        {COMPARISONS.map((c) => (
          <li key={c.slug}>
            <Link to={`/vs/${c.slug}`}><strong>Dreamify vs {c.competitor}</strong></Link>
            <div>{c.description}</div>
          </li>
        ))}
      </ul>
    </MarketingShell>
  </>
);

export default VsHub;
