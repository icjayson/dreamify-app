import React from 'react';
import DocsLayout from '@/components/layout/DocsLayout';
import Seo from '@/components/seo/Seo';

export const PRIVACY_METADATA = {
  title: "Privacy Policy",
  effectiveDate: "March 12, 2026",
  description: "Welcome to Dreamify. Protecting your data and privacy is our top priority. This Privacy Policy explains how we collect, use, store, and protect your personal information when you use Dreamify's services."
};

export const PRIVACY_TOC = [
  { id: "information-we-collect", title: "1. Information We Collect" },
  { id: "how-we-use-your-data", title: "2. How We Use Your Data" },
  { id: "sharing-data", title: "3. Sharing Data with Third Parties" },
  { id: "data-storage-security", title: "4. Data Storage, Security, and Retention" },
  { id: "your-data-rights", title: "5. Your Data Control Rights" },
  { id: "contact-us", title: "6. Contact Us" },
];

export const PrivacyContent: React.FC = () => (
  <>
    <section id="information-we-collect">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">1. Information We Collect</h2>
      <p className="mb-3 text-muted-foreground">When you use Dreamify, we collect the following types of information:</p>
      <ul className="list-disc pl-6 space-y-3 text-muted-foreground">
        <li><strong className="text-foreground font-medium">Account Information:</strong> Your name, email address, and profile picture when you log in through authentication services (e.g., Google, Clerk).</li>
        <li><strong className="text-foreground font-medium">Third-Party Service Data (Google APIs):</strong> If you authorize Dreamify to connect to your Google Analytics 4 (GA4) or Google Sheets, we will collect the respective files and analytics data as explicitly permitted by you.</li>
        <li><strong className="text-foreground font-medium">User-Uploaded Data:</strong> CSV files or financial data that you actively upload to our platform for analysis.</li>
        <li><strong className="text-foreground font-medium">Usage Data:</strong> Information about how you interact with our website, collected anonymously through Google Analytics 4 (GA4) to improve user experience and platform performance.</li>
      </ul>
    </section>

    <section id="how-we-use-your-data">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">2. How We Use Your Data</h2>
      <p className="mb-3 text-muted-foreground">Your data is used strictly for the core purposes of providing and maintaining our services:</p>
      <ul className="list-disc pl-6 space-y-3 text-muted-foreground">
        <li>To process, analyze, and visualize data (e.g., generating charts and dynamic dashboards) based on your formatting requests and natural language queries.</li>
        <li>To provide technical support and respond to your inquiries via email.</li>
      </ul>
      <div className="mt-6 p-5 border border-border rounded-xl bg-card">
        <h3 className="font-semibold mb-2 text-foreground">Google API Services User Data Policy (Limited Use Policy):</h3>
        <p className="text-muted-foreground leading-relaxed">Dreamify's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. We strictly do not use your data from Google APIs for advertising purposes, nor do we sell it to any third parties.</p>
      </div>
    </section>

    <section id="sharing-data">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">3. Sharing Data with Third Parties (AI Processing)</h2>
      <p className="mb-3 text-muted-foreground">The default deterministic demo provider does not send your prompt or uploaded data to an external AI model. If you explicitly configure and activate a bring-your-own-key provider, Dreamify sends the minimum required workflow context to the selected OpenAI, Google Gemini, or DeepSeek API.</p>
      <ul className="list-disc pl-6 space-y-3 text-muted-foreground">
        <li><strong className="text-foreground font-medium">Sole Purpose:</strong> Provider requests are made only to generate the analysis, clarification, narrative, or dashboard requested in your workspace.</li>
        <li><strong className="text-foreground font-medium">Credential Protection:</strong> Provider keys are encrypted at rest, never returned to the browser after saving, and are not placed in workflow payloads, Blob objects, or Sandbox environments.</li>
        <li><strong className="text-foreground font-medium">Provider Terms:</strong> When BYOK is active, the selected provider processes requests under your provider account and its current privacy and data-use terms.</li>
      </ul>
    </section>

    <section id="data-storage-security">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">4. Data Storage, Security, and Retention</h2>
      <ul className="list-disc pl-6 space-y-3 text-muted-foreground">
        <li><strong className="text-foreground font-medium">Data Retention:</strong> This preview stores projects, uploads, conversations, and dashboard versions until you delete them or the deployment owner performs a documented preview reset. No legacy AWS data or users are imported.</li>
        <li><strong className="text-foreground font-medium">Security:</strong> We employ industry-standard encryption measures to protect your data during transmission and while stored on our infrastructure.</li>
      </ul>
    </section>

    <section id="your-data-rights">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">5. Your Data Control Rights</h2>
      <p className="mb-3 text-muted-foreground">You have full control over your data. At any time, you have the right to:</p>
      <ul className="list-disc pl-6 space-y-3 text-muted-foreground">
        <li>Manually delete your projects, data files, or chat history directly within the Dreamify interface.</li>
        <li>Request the immediate deletion of your entire account and all associated data by contacting our support team.</li>
        <li>Revoke Dreamify's access to your Google account through your Google Account Security Settings page.</li>
      </ul>
    </section>

    <section id="contact-us">
      <h2 className="text-2xl font-semibold mb-4 text-foreground">6. Contact Us</h2>
      <p className="text-muted-foreground mb-4">If you have any questions about this Privacy Policy or wish to exercise your data deletion rights, please contact us at:</p>
      <p className="font-medium text-foreground">Support Email: <a href="mailto:dreamify.dev@gmail.com" className="text-primary hover:underline font-semibold">dreamify.dev@gmail.com</a></p>
    </section>
  </>
);

const Privacy = () => (
  <>
    <Seo
      title="Dreamify Privacy Policy — How We Handle Your Data"
      description="How Dreamify collects, uses, stores, and protects your personal information, including Google API data handling under the Limited Use Policy."
      canonical="https://dreamify-web.vercel.app/privacy"
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": "https://dreamify-web.vercel.app/privacy#webpage",
        url: "https://dreamify-web.vercel.app/privacy",
        name: "Dreamify Privacy Policy",
        isPartOf: { "@id": "https://dreamify-web.vercel.app/#website" },
        inLanguage: "en",
      }}
    />
    <DocsLayout metadata={PRIVACY_METADATA} toc={PRIVACY_TOC}>
      <PrivacyContent />
    </DocsLayout>
  </>
);

export default Privacy;
