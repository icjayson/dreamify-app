import { Link, useParams } from "@/lib/navigation";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";
import { getComparison } from "@/content/vs";
import NotFound from "@/legacy-pages/NotFound";

const ComparisonPage = () => {
  const { competitor } = useParams<{ competitor: string }>();
  const comparison = competitor ? getComparison(competitor) : undefined;

  if (!comparison) return <NotFound />;

  const canonical = `https://dreamify-web.vercel.app/vs/${comparison.slug}`;

  return (
    <>
      <Seo
        title={`Dreamify and ${comparison.competitor} — Archived Comparison Placeholder`}
        description="This legacy comparison is not current product research. The page states only the locked Dreamify Hobby-demo scope."
        canonical={canonical}
        noindex
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Dreamify", item: "https://dreamify-web.vercel.app/" },
            { "@type": "ListItem", position: 2, name: `vs ${comparison.competitor}`, item: canonical },
          ],
        }}
      />
      <MarketingShell>
        <h1>Dreamify and {comparison.competitor}</h1>
        <p><strong>Archived comparison placeholder:</strong> competitor facts and prices in the legacy draft have not been re-verified, so they are intentionally not rendered as current claims.</p>

        <h2>Current Dreamify Hobby-demo scope</h2>
        <table>
          <thead>
            <tr>
              <th>Dimension</th>
              <th>Current Dreamify deployment</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Intended use", "Private, invitation-only, personal non-commercial evaluation"],
              ["Guaranteed data source", "CSV, XLSX, XLS, and flat JSON file upload"],
              ["AI", "Deterministic demo provider by default; encrypted OpenAI, Gemini, or DeepSeek BYOK is optional"],
              ["External connectors", "Unavailable unless credentials and provider smoke tests pass"],
              ["Workspace delivery and schedules", "Disabled by default"],
              ["Billing", "Checkout, subscriptions, and credit debits disabled"],
            ].map(([dimension, value]) => (
              <tr key={dimension}>
                <td><strong>{dimension}</strong></td>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>No commercial comparison claim</h2>
        <p>This deployment is not a commercial replacement for {comparison.competitor}, does not offer an SLA, and should not be evaluated from archived pricing or feature assertions.</p>

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

export default ComparisonPage;
