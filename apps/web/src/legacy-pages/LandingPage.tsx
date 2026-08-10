import { Link } from "@/lib/navigation";
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
        description="An invite-only AI data visualization demo for bounded file analysis, editable dashboards, and optional OpenAI, Gemini, or DeepSeek BYOK."
        canonical="https://dreamify-web.vercel.app/landingpage"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "@id": "https://dreamify-web.vercel.app/landingpage#webpage",
            url: "https://dreamify-web.vercel.app/landingpage",
            name: "Dreamify — AI Data Visualization",
            isPartOf: { "@id": "https://dreamify-web.vercel.app/#website" },
            about: { "@id": "https://dreamify-web.vercel.app/#organization" },
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
                  text: "CSV, XLSX, XLS, and flat JSON uploads are supported now. External connector cards remain unavailable until provider-specific certification passes.",
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
                  text: "Dashboards live in the private Dreamify preview and can be exported. Chat delivery and scheduling are disabled in the Hobby release.",
                },
              },
              {
                "@type": "Question",
                name: "What does Dreamify cost?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "This invitation-only Vercel Hobby deployment is a free, non-commercial preview. Billing and credit debits are disabled; technical usage limits apply.",
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
            Dreamify turns bounded CSV, Excel, and flat JSON uploads into decision-ready
            dashboards. It runs with deterministic templates by default, or with your encrypted
            OpenAI, Gemini, or DeepSeek key.
          </p>
          <p>
            <Link to="/signup" className="inline-block rounded-md bg-primary text-primary-foreground px-5 py-2 font-medium no-underline">
              Open the invite-only preview
            </Link>
          </p>
        </section>

        <section>
          <h2>How Dreamify Works</h2>
          <ol>
            <li><strong>Upload</strong> — add up to three bounded CSV, Excel, or flat JSON files.</li>
            <li><strong>Analyze</strong> — Dreamify profiles the data and asks when intent is ambiguous.</li>
            <li><strong>Visualize</strong> — edit, version, revert, and export the generated dashboard.</li>
          </ol>
        </section>

        <section>
          <h2>Built for Your Stack</h2>
          <p>
            Connector surfaces are preserved for the migration. File upload is active; every
            external source stays unavailable until its credential and smoke-test gates pass.
          </p>
          <ul>
            {activeConnectors.map((c) => (
              <li key={c.name}>
                <Link to={`/product/data-connectors/${slugify(c.name)}`}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Workspace delivery roadmap</h2>
          <p>
            Slack, Telegram, Zalo, and WhatsApp screens remain visible but are disabled in this
            Hobby release. Scheduling and channel delivery are not part of the guaranteed demo.
          </p>
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
          <h2>Free Preview</h2>
          <p>
            Invitation-only, non-commercial, and <strong>$0</strong> on the Hobby profile. Billing is disabled.{" "}
            <Link to="/pricing">Review technical limits →</Link>
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
          <p>This is a free, invitation-only preview with technical run and storage limits. No checkout or subscription is available.</p>
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
