import { Link } from "react-router-dom";
import Seo from "@/components/seo/Seo";
import MarketingShell from "@/components/seo/MarketingShell";

const SecurityPage = () => (
  <>
    <Seo
      title="Security at Dreamify — Encryption, Access, and Data Handling"
      description="How Dreamify protects your data: encryption in transit and at rest, read-only connectors, OAuth-based access, regional data residency, and the path to SOC 2."
      canonical="https://app.dreamify.dev/security"
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": "https://app.dreamify.dev/security#webpage",
        url: "https://app.dreamify.dev/security",
        name: "Dreamify Security",
        isPartOf: { "@id": "https://app.dreamify.dev/#website" },
        inLanguage: "en",
      }}
    />
    <MarketingShell>
      <h1>Security at Dreamify</h1>
      <p>Dreamify is a trusted system of record for the data your business depends on. Here's how we protect it.</p>

      <h2>Encryption</h2>
      <p>All connections to Dreamify use TLS 1.2 or higher. Customer data is encrypted at rest using AES-256. Credentials and OAuth tokens for connected sources are encrypted with envelope encryption and never exposed in the UI.</p>

      <h2>Access to your sources</h2>
      <p>Where possible, Dreamify uses OAuth with read-only scopes (Meta, Google Ads, GA4, TikTok, Stripe). For database connections (PostgreSQL), we require a read-only role and support SSL and SSH tunneling. Dreamify never writes back to source systems.</p>

      <h2>Workspace authentication</h2>
      <p>Sign in is handled by Clerk with optional SSO. Team plans support role-based access control and granular dashboard sharing.</p>

      <h2>Data residency</h2>
      <p>Dreamify operates primary infrastructure in the United States, with regional data residency planned for the EU and Asia. If your business has data residency requirements, contact us before connecting production data.</p>

      <h2>Tenant isolation</h2>
      <p>Each customer's data is isolated at the application layer with per-tenant access checks on every read. Tenant identifiers are propagated through all data paths.</p>

      <h2>Operational security</h2>
      <p>Production access requires MFA and is restricted to a small group of engineers. All production changes are auditable. We run least-privilege IAM across our cloud accounts.</p>

      <h2>Subprocessors</h2>
      <p>Dreamify uses a small set of subprocessors for hosting, authentication, billing, and analytics. The full list is available on request and is updated with notice ahead of any change.</p>

      <h2>Roadmap</h2>
      <p>SOC 2 Type I is targeted within the next 12 months. GDPR posture documentation is available on request. If you need a DPA or vendor security review packet, contact us.</p>

      <h2>Reporting a vulnerability</h2>
      <p>Security researchers and customers can email <a href="mailto:security@dreamify.dev">security@dreamify.dev</a>. We acknowledge reports within two business days.</p>

      <h2>Questions?</h2>
      <p>
        <Link to="/signup" className="inline-block rounded-md bg-primary text-primary-foreground px-5 py-2 font-medium no-underline">
          Start free — see Dreamify in action with your own data
        </Link>
      </p>
    </MarketingShell>
  </>
);

export default SecurityPage;
