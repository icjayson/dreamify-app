import { Link } from "@/lib/navigation";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";
import { CUSTOMERS } from "@/content/customers";

const CustomersIndex = () => (
  <>
    <Seo
      title="Archived Dreamify Scenarios — Not Customer Evidence"
      description="Illustrative legacy migration scenarios retained for design review. They are not verified Dreamify customer stories or measured outcomes."
      canonical="https://dreamify-web.vercel.app/customers"
      noindex
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Archived Dreamify Scenarios",
        url: "https://dreamify-web.vercel.app/customers",
        isPartOf: { "@id": "https://dreamify-web.vercel.app/#website" },
      }}
    />
    <MarketingShell>
      <h1>Illustrative migration scenarios</h1>
      <p><strong>Not customer evidence:</strong> these entries came from the legacy marketing archive. No customer identity, quote, metric, or outcome on these pages has been verified for the Hobby demo.</p>
      <ul>
        {CUSTOMERS.map((c) => (
          <li key={c.slug}>
            <Link to={`/customers/${c.slug}`}><strong>Illustrative {c.industry} scenario</strong></Link>
            <div>{c.size} · {c.region} · archived concept</div>
            <div>No verified customer or measured result is asserted.</div>
          </li>
        ))}
      </ul>
    </MarketingShell>
  </>
);

export default CustomersIndex;
