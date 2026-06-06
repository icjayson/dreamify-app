import { Link, useParams } from "react-router-dom";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";
import { getComparison } from "@/content/vs";
import NotFound from "@/pages/NotFound";

const ComparisonPage = () => {
  const { competitor } = useParams<{ competitor: string }>();
  const comparison = competitor ? getComparison(competitor) : undefined;

  if (!comparison) return <NotFound />;

  const canonical = `https://app.dreamify.dev/vs/${comparison.slug}`;

  return (
    <>
      <Seo
        title={comparison.title}
        description={comparison.description}
        canonical={canonical}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Dreamify", item: "https://app.dreamify.dev/" },
            { "@type": "ListItem", position: 2, name: `vs ${comparison.competitor}`, item: canonical },
          ],
        }}
      />
      <MarketingShell>
        <h1>Dreamify vs {comparison.competitor}</h1>
        <p>{comparison.description}</p>

        <h2>TL;DR</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>{comparison.competitor}</th>
              <th>Dreamify</th>
            </tr>
          </thead>
          <tbody>
            {comparison.tldr.map((r) => (
              <tr key={r.dimension}>
                <td><strong>{r.dimension}</strong></td>
                <td>{r.competitor}</td>
                <td>{r.dreamify}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Scenario: {comparison.scenario.title}</h2>
        <p>{comparison.scenario.body}</p>

        <h2>Where {comparison.competitor} is strong</h2>
        <ul>
          {comparison.competitorPros.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>

        <h2>Where Dreamify wins</h2>
        {comparison.dreamifyWins.map((w) => (
          <div key={w.title}>
            <h3>{w.title}</h3>
            <p>{w.body}</p>
          </div>
        ))}

        <h2>Pricing</h2>
        <p><strong>{comparison.competitor}:</strong> {comparison.pricing.competitor}</p>
        <p><strong>Dreamify:</strong> {comparison.pricing.dreamify}</p>

        {comparison.migrationNotes && (
          <>
            <h2>Migration notes</h2>
            <p>{comparison.migrationNotes}</p>
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

export default ComparisonPage;
