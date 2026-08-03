import MarketingShell from "@/components/seo/MarketingShell";
import Seo from "@/components/seo/Seo";
import { Link } from "@/lib/navigation";

const SecurityPage = () => (
  <>
    <Seo
      title="Security boundaries — Dreamify Hobby demo"
      description="The security model and explicit limitations of Dreamify's private, invite-only Hobby demo."
      canonical="https://dreamify-web.vercel.app/security"
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": "https://dreamify-web.vercel.app/security#webpage",
        url: "https://dreamify-web.vercel.app/security",
        name: "Dreamify Hobby demo security boundaries",
        isPartOf: { "@id": "https://dreamify-web.vercel.app/#website" },
        inLanguage: "en",
      }}
    />
    <MarketingShell>
      <h1>Security boundaries</h1>
      <p>
        This deployment is a private, invite-only, non-commercial Hobby demo. It is not a
        production system of record, does not provide an uptime SLA, and does not claim a
        compliance certification. Use sample or non-sensitive data only.
      </p>

      <h2>Identity and tenant access</h2>
      <p>
        Clerk handles sign-in for a newly created Dreamify application. The API derives the
        user identity from the verified token and applies owner/member checks to tenant data.
        No legacy users or AWS data are imported.
      </p>

      <h2>Data storage</h2>
      <p>
        Neon Postgres is the application source of truth and private Vercel Blob stores uploaded
        files and generated artifacts. Uploads use immutable, user-scoped paths, checksums,
        quota reservations, and short-lived access. The browser uploads directly to Blob; the
        API validates the object before recording it.
      </p>

      <h2>AI and BYOK</h2>
      <p>
        Without a provider key, Dreamify uses deterministic local templates. Optional OpenAI or
        Gemini keys are encrypted server-side with an application keyring. Raw keys are never
        returned to the browser or placed in Workflow payloads, Blob objects, Sandboxes, or
        application logs. Adding a key sends prompts and selected data to that provider under
        the provider's own terms.
      </p>

      <h2>Analysis isolation</h2>
      <p>
        File analysis runs in a bounded Vercel Sandbox. Generated Python receives no service
        credentials, loses network access after input staging, uses an import allowlist, and has
        fixed time, memory, and output limits. These controls reduce risk but do not turn this
        Hobby deployment into a certified production environment.
      </p>

      <h2>Connectors</h2>
      <p>
        File upload is the only guaranteed data source in this release. Connector cards remain
        visible for UI parity, but each connector stays unavailable until credentials exist and
        its OAuth or webhook signatures, least-privilege scopes, and provider smoke test pass.
      </p>

      <h2>Deployment region and retention</h2>
      <p>
        Vercel runtime and Blob resources are configured in Singapore. Neon should be provisioned
        in a nearby supported region. Demo data remains until the user deletes it or the operator
        resets the preview; soft storage limits stop new writes before free-tier capacity is
        exhausted.
      </p>

      <h2>Reporting a vulnerability</h2>
      <p>
        Send reports to <a href="mailto:security@dreamify.dev">security@dreamify.dev</a>. Do not
        include secrets, provider keys, or sensitive customer data in the report.
      </p>

      <h2>Before you upload</h2>
      <p>
        <Link
          to="/docs"
          className="inline-block rounded-md bg-primary px-5 py-2 font-medium text-primary-foreground no-underline"
        >
          Read the preview limits and operating guide
        </Link>
      </p>
    </MarketingShell>
  </>
);

export default SecurityPage;
