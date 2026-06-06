import { Link } from "react-router-dom";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";
import { CONNECTORS } from "@/constants/connectors";
import { WORKSPACES } from "@/content/workspaces";
import { slugify } from "@/utils/slugify";

const LandingPage = () => {
  const activeConnectors = CONNECTORS.filter((c) => c.isActive);

  return (
    <>
      <Seo
        title="Dreamify — AI Data Visualization. Dashboards in Minutes, Not Days."
        description="AI Data Visualization for marketers, sellers, and founders. Connect Meta Ads, Google Ads, GA4, TikTok, Stripe, Sheets, PostgreSQL — get decision-ready dashboards in minutes. No formulas. No BI setup."
        canonical="https://app.dreamify.dev/landingpage"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "@id": "https://app.dreamify.dev/landingpage#webpage",
            url: "https://app.dreamify.dev/landingpage",
            name: "Dreamify — AI Data Visualization",
            isPartOf: { "@id": "https://app.dreamify.dev/#website" },
            about: { "@id": "https://app.dreamify.dev/#organization" },
            inLanguage: "en",
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              {
                "@type": "Question",
                name: "How is Dreamify different from Power BI or Tableau?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Dreamify generates dashboards from raw data in minutes with no manual setup. Power BI and Tableau require data modeling, formulas, and a BI specialist.",
                },
              },
              {
                "@type": "Question",
                name: "What data sources does Dreamify support?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase, Stripe, Google Sheets, and PostgreSQL.",
                },
              },
              {
                "@type": "Question",
                name: "Do I need a data team to use Dreamify?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "No. Dreamify is built for non-technical marketers, sellers, and founders. No SQL, no formulas.",
                },
              },
              {
                "@type": "Question",
                name: "Where do dashboards live?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "In Dreamify and inside Slack, Telegram, Zalo, and WhatsApp — wherever your team already works.",
                },
              },
              {
                "@type": "Question",
                name: "What does Dreamify cost?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Sandbox is free with 100 credits per month. Pro is $15 per month for unlimited connectors. Team is $18 per seat per month.",
                },
              },
            ],
          },
        ]}
      />
      <MarketingShell>
        <section>
          <h1>AI Data Visualization. Dashboards in Minutes, Not Days.</h1>
          <p>
            Dreamify turns raw data from Meta Ads, Google Ads, GA4, TikTok, Stripe, and spreadsheets into
            decision-ready dashboards. No formulas. No BI setup. No data team required.
          </p>
          <p>
            <Link to="/signup" className="inline-block rounded-md bg-primary text-primary-foreground px-5 py-2 font-medium no-underline">
              Start free — no credit card
            </Link>
          </p>
        </section>

        <section>
          <h2>How Dreamify Works</h2>
          <ol>
            <li><strong>Connect</strong> — plug in your data sources in one click.</li>
            <li><strong>Analyze</strong> — Dreamify reads schemas, cleans, and surfaces insights automatically.</li>
            <li><strong>Visualize</strong> — decision-ready dashboards ready to share and schedule.</li>
          </ol>
        </section>

        <section>
          <h2>Built for Your Stack</h2>
          <p>Native connectors for the platforms marketers and operators actually use.</p>
          <ul>
            {activeConnectors.map((c) => (
              <li key={c.name}>
                <Link to={`/product/data-connectors/${slugify(c.name)}`}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Lives Where Your Team Already Works</h2>
          <p>Schedule dashboards, get anomaly alerts, and ask follow-up questions inside your team's chat.</p>
          <ul>
            {WORKSPACES.map((w) => (
              <li key={w.slug}>
                <Link to={`/product/workspace-agents/${w.slug}`}>Dreamify in {w.name}</Link>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>For Marketers. For Sellers. For Founders.</h2>
          <p>
            <strong>Marketers:</strong> Multi-channel ad performance dashboards delivered to your team's chat every morning.
          </p>
          <p>
            <strong>Sellers and agencies:</strong> One-click client dashboards. Onboard new accounts in minutes, not weeks.
          </p>
          <p>
            <strong>Founders and ops:</strong> Weekly KPI snapshots, MRR/churn tracking, and operational alerts — without a data team.
          </p>
        </section>

        <section>
          <h2>Pricing</h2>
          <p>
            Sandbox <strong>$0</strong> · Pro <strong>$15/mo</strong> · Team <strong>$18/seat/mo</strong>.{" "}
            <Link to="/pricing">Compare plans →</Link>
          </p>
        </section>

        <section>
          <h2>Frequently Asked Questions</h2>
          <h3>How is Dreamify different from Power BI or Tableau?</h3>
          <p>Dreamify generates dashboards from raw data in minutes with no manual setup. Power BI and Tableau require data modeling, formulas, and a BI specialist.</p>
          <h3>What data sources does Dreamify support?</h3>
          <p>Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase, Stripe, Google Sheets, and PostgreSQL.</p>
          <h3>Do I need a data team to use Dreamify?</h3>
          <p>No. Dreamify is built for non-technical marketers, sellers, and founders. No SQL, no formulas.</p>
          <h3>Where do dashboards live?</h3>
          <p>In Dreamify and inside Slack, Telegram, Zalo, and WhatsApp — wherever your team already works.</p>
          <h3>What does Dreamify cost?</h3>
          <p>Sandbox is free with 100 credits per month. Pro is $15/month for unlimited connectors. Team is $18/seat/month.</p>
        </section>

        <section>
          <h2>Start Free — Generate Your First Dashboard in Minutes</h2>
          <p>
            <Link to="/signup" className="inline-block rounded-md bg-primary text-primary-foreground px-5 py-2 font-medium no-underline">
              Get started — no credit card required
            </Link>
          </p>
        </section>
      </MarketingShell>
    </>
  );
};

export default LandingPage;
