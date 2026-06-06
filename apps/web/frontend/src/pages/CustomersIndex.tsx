import { Link } from "react-router-dom";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";
import { CUSTOMERS } from "@/content/customers";

const CustomersIndex = () => (
  <>
    <Seo
      title="Dreamify Customer Stories — How SMEs Ship Dashboards in Minutes"
      description="Real customer case studies: how Dreamify replaces manual reporting with AI-generated dashboards delivered into Slack, Telegram, Zalo, and WhatsApp."
      canonical="https://app.dreamify.dev/customers"
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Dreamify Customer Stories",
        url: "https://app.dreamify.dev/customers",
        isPartOf: { "@id": "https://app.dreamify.dev/#website" },
      }}
    />
    <MarketingShell>
      <h1>Customer Stories</h1>
      <p>Real teams using Dreamify to replace manual reporting with AI-generated dashboards.</p>
      <ul>
        {CUSTOMERS.map((c) => (
          <li key={c.slug}>
            <Link to={`/customers/${c.slug}`}><strong>{c.title}</strong></Link>
            <div>{c.industry} · {c.size} · {c.region}</div>
            <div>{c.description}</div>
          </li>
        ))}
      </ul>
    </MarketingShell>
  </>
);

export default CustomersIndex;
