import { Link } from "react-router-dom";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";

const FeaturesPage = () => (
  <>
    <Seo
      title="Dreamify Features — Connect, Analyze, Visualize"
      description="What Dreamify does: AI dashboard generation, native connectors, workspace delivery, scheduled reports, anomaly alerts, and natural-language follow-up Q&A."
      canonical="https://app.dreamify.dev/features"
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": "https://app.dreamify.dev/features#webpage",
        url: "https://app.dreamify.dev/features",
        name: "Dreamify Features",
        isPartOf: { "@id": "https://app.dreamify.dev/#website" },
        inLanguage: "en",
      }}
    />
    <MarketingShell>
      <h1>What Dreamify Does</h1>
      <p>Three things, well: <strong>Connect, Analyze, Visualize</strong>. Then deliver everything to where your team works.</p>

      <h2>Connect</h2>
      <p>Native connectors to the platforms marketers and operators actually use: Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase, Stripe, Google Sheets, and PostgreSQL. One-click OAuth for the marketing platforms; secure read-only credentials for databases. No third-party paid connector marketplace.</p>

      <h2>Analyze</h2>
      <p>Dreamify auto-detects your schema, cleans inconsistencies, and identifies which metrics matter for the dashboard you're building. Cross-source joins happen automatically — UTM tags, campaign IDs, and customer keys link your ad spend to your conversion data without manual configuration.</p>

      <h2>Visualize</h2>
      <p>Describe the dashboard in plain language; Dreamify picks the right chart types, breakdowns, and KPI cards. Refine in chat — swap a metric, change a breakdown, add a filter. The dashboard updates in place.</p>

      <h2>Deliver Where You Work</h2>
      <p>Dashboards live in Slack, Telegram, Zalo, and WhatsApp. Scheduled snapshots, anomaly alerts, and reply-to-ask follow-up Q&A. Every dashboard is also a shareable public link with embed support.</p>

      <h2>Other capabilities</h2>
      <ul>
        <li>Scheduled reports (daily, weekly, monthly, custom cron)</li>
        <li>Anomaly and threshold alerts</li>
        <li>Natural-language follow-up Q&A on any dashboard</li>
        <li>Export to PNG and PDF</li>
        <li>Shareable public dashboard links</li>
        <li>Multi-source joins on UTM and campaign keys</li>
        <li>Custom date ranges and rolling windows</li>
      </ul>

      <h2>Try the full stack</h2>
      <p>
        <Link to="/signup" className="inline-block rounded-md bg-primary text-primary-foreground px-5 py-2 font-medium no-underline">
          Start free — generate your first dashboard in minutes
        </Link>
      </p>
    </MarketingShell>
  </>
);

export default FeaturesPage;
