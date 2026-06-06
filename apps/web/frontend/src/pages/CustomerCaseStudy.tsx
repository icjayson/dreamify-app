import { Link, useParams } from "react-router-dom";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";
import { getCustomer } from "@/content/customers";
import NotFound from "@/pages/NotFound";

const CustomerCaseStudy = () => {
  const { slug } = useParams<{ slug: string }>();
  const customer = slug ? getCustomer(slug) : undefined;

  if (!customer) return <NotFound />;

  const canonical = `https://app.dreamify.dev/customers/${customer.slug}`;

  return (
    <>
      <Seo
        title={customer.title}
        description={customer.description}
        canonical={canonical}
        ogType="article"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: customer.title,
            description: customer.description,
            mainEntityOfPage: canonical,
            audience: { "@type": "Audience", audienceType: customer.persona },
            publisher: { "@id": "https://app.dreamify.dev/#organization" },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Dreamify", item: "https://app.dreamify.dev/" },
              { "@type": "ListItem", position: 2, name: "Customers", item: "https://app.dreamify.dev/customers" },
              { "@type": "ListItem", position: 3, name: customer.customerName, item: canonical },
            ],
          },
        ]}
      />
      <MarketingShell>
        <p>
          <Link to="/customers">← All customer stories</Link>
        </p>
        <h1>{customer.title}</h1>
        <p><em>{customer.industry} · {customer.size} · {customer.region}</em></p>

        {customer.placeholder && (
          <p>
            <em>
              Case study published with anonymized identifiers — the customer's full name and screenshots
              will be added with their permission as part of our M3 customer story program.
            </em>
          </p>
        )}

        <h2>Featured outcome</h2>
        <p><strong>{customer.featuredMetric.label}:</strong> {customer.featuredMetric.value}</p>

        <h2>The challenge</h2>
        <p>{customer.challenge}</p>

        <h2>The solution</h2>
        <p>{customer.solution}</p>

        <h2>The outcomes</h2>
        <ul>
          {customer.outcomes.map((o) => (
            <li key={o.label}><strong>{o.label}:</strong> {o.value}</li>
          ))}
        </ul>

        {customer.quote && (
          <>
            <h2>In their words</h2>
            <blockquote>"{customer.quote.text}"</blockquote>
            <p><em>— {customer.quote.name}, {customer.quote.role}</em></p>
          </>
        )}

        <h2>Try Dreamify free</h2>
        <p>
          <Link to="/signup" className="inline-block rounded-md bg-primary text-primary-foreground px-5 py-2 font-medium no-underline">
            Generate your first dashboard in minutes — no credit card
          </Link>
        </p>
      </MarketingShell>
    </>
  );
};

export default CustomerCaseStudy;
