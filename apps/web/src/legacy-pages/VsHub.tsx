import { Link } from "@/lib/navigation";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";
import { COMPARISONS } from "@/content/vs";

const VsHub = () => (
  <>
    <Seo
      title="Archived Dreamify Comparison Drafts"
      description="Legacy comparison drafts retained for migration review. Competitor facts are not currently verified and no product-parity claim is made."
      canonical="https://dreamify-web.vercel.app/vs"
      noindex
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Dreamify Comparisons",
        url: "https://dreamify-web.vercel.app/vs",
        isPartOf: { "@id": "https://dreamify-web.vercel.app/#website" },
      }}
    />
    <MarketingShell>
      <h1>Archived comparison drafts</h1>
      <p>These legacy pages are retained for migration review. Competitor features and prices can change, so the Hobby demo does not present them as current research or claim feature parity.</p>
      <ul>
        {COMPARISONS.map((c) => (
          <li key={c.slug}>
            <Link to={`/vs/${c.slug}`}><strong>{c.competitor} comparison placeholder</strong></Link>
            <div>Current Dreamify Hobby-demo boundaries only; legacy comparative claims are not rendered.</div>
          </li>
        ))}
      </ul>
    </MarketingShell>
  </>
);

export default VsHub;
