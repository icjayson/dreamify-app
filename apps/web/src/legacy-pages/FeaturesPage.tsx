import { Link } from "@/lib/navigation";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";

const FeaturesPage = () => (
  <>
    <Seo
      title="Dreamify Hobby demo — Upload, Analyze, Visualize"
      description="What the invite-only Dreamify preview supports today: bounded file upload, deterministic or BYOK analysis, editable dashboards, version history, and export."
      canonical="https://dreamify-web.vercel.app/features"
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": "https://dreamify-web.vercel.app/features#webpage",
        url: "https://dreamify-web.vercel.app/features",
        name: "Dreamify Features",
        isPartOf: { "@id": "https://dreamify-web.vercel.app/#website" },
        inLanguage: "en",
      }}
    />
    <MarketingShell>
      <h1>What the Hobby demo supports</h1>
      <p>
        This invite-only preview focuses on one complete path: <strong>Upload, Analyze,
        Visualize</strong>. Billing, schedules, and uncertified external connectors stay off.
      </p>

      <h2>Upload</h2>
      <p>
        Upload CSV, XLSX, XLS, or flat JSON directly to private object storage. A run accepts up
        to three files, 10 MiB per file and 25 MiB total, with row, column, user-storage, and
        deployment-storage guards enforced by the API.
      </p>

      <h2>Analyze</h2>
      <p>
        Dreamify profiles the uploaded files, asks for clarification when intent is ambiguous,
        and produces structured insights. The default provider is deterministic and requires no
        model key. A user can activate OpenAI, Gemini, or DeepSeek with an encrypted BYOK connection.
      </p>

      <h2>Visualize</h2>
      <p>
        Describe the dashboard in plain language, refine it in chat, edit chart settings, retain
        versions, revert changes, and export PNG or PDF. Dashboard payloads are capped at 1 MiB.
      </p>

      <h2>Connector previews</h2>
      <p>
        The original connector cards and modals remain visible for UI parity. A card becomes
        active only after its credentials, callback security, and provider smoke test pass. File
        upload is the only guaranteed source in this release; chat delivery is unavailable.
      </p>

      <h2>Other capabilities</h2>
      <ul>
        <li>Invite-only Clerk authentication and per-tenant access checks</li>
        <li>CSV, XLSX, XLS, and flat JSON file analysis</li>
        <li>Natural-language follow-up Q&A on any dashboard</li>
        <li>Export to PNG and PDF</li>
        <li>Dashboard edit, version, and revert</li>
        <li>Deterministic demo mode or encrypted OpenAI/Gemini/DeepSeek BYOK</li>
        <li>Durable run status, reconnectable events, cancellation, and retry safety</li>
      </ul>

      <h2>Try the private preview</h2>
      <p>
        <Link to="/signup" className="inline-block rounded-md bg-primary text-primary-foreground px-5 py-2 font-medium no-underline">
          Open the invite-only preview
        </Link>
      </p>
    </MarketingShell>
  </>
);

export default FeaturesPage;
