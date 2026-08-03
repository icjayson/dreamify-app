import { Link, useParams } from "@/lib/navigation";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";
import { getCustomer } from "@/content/customers";
import NotFound from "@/legacy-pages/NotFound";

const CustomerCaseStudy = () => {
  const { slug } = useParams<{ slug: string }>();
  const customer = slug ? getCustomer(slug) : undefined;

  if (!customer) return <NotFound />;

  const canonical = `https://dreamify-web.vercel.app/customers/${customer.slug}`;

  return (
    <>
      <Seo
        title={`Illustrative ${customer.industry} Scenario — Not Customer Evidence`}
        description="An archived legacy marketing scenario retained for design review. It is not a verified customer case study or measured Dreamify result."
        canonical={canonical}
        ogType="article"
        noindex
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `Illustrative ${customer.industry} scenario`,
            description: "Archived concept; not verified customer evidence.",
            mainEntityOfPage: canonical,
            audience: { "@type": "Audience", audienceType: customer.persona },
            publisher: { "@id": "https://dreamify-web.vercel.app/#organization" },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Dreamify", item: "https://dreamify-web.vercel.app/" },
              { "@type": "ListItem", position: 2, name: "Customers", item: "https://dreamify-web.vercel.app/customers" },
              { "@type": "ListItem", position: 3, name: `Illustrative ${customer.industry} scenario`, item: canonical },
            ],
          },
        ]}
      />
      <MarketingShell>
        <p>
          <Link to="/customers">← All illustrative scenarios</Link>
        </p>
        <h1>Illustrative {customer.industry} migration scenario</h1>
        <p><em>{customer.size} · {customer.region} · archived concept</em></p>

        <h2>Evidence status</h2>
        <p><strong>This is not a customer case study.</strong> The legacy draft contained placeholder identities and unverified numerical outcomes. Those claims are intentionally not rendered in the migrated Hobby demo.</p>

        <h2>Current Dreamify scope</h2>
        <ul>
          <li>Private, invitation-only, non-commercial evaluation</li>
          <li>File upload is the only guaranteed data source</li>
          <li>External connectors, workspace agents, scheduling, and public links are unavailable by default</li>
          <li>Billing, checkout, subscriptions, and credit debits are disabled</li>
        </ul>

        <h2>Open the preview</h2>
        <p>
          <Link to="/login" className="inline-block rounded-md bg-primary text-primary-foreground px-5 py-2 font-medium no-underline">
            Log in with an invitation
          </Link>
        </p>
      </MarketingShell>
    </>
  );
};

export default CustomerCaseStudy;
