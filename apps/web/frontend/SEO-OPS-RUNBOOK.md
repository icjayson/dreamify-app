# SEO Ops Runbook

The non-code ops layer for Sections A–E. Code is shipped; these are the platform submissions that compound over time.

Every item below includes the exact URL, the steps, and the copy to paste. Run through them top to bottom — owner column suggests who on the team should do each.

---

## 0. Shared canonical copy (paste-ready)

Reuse these strings everywhere a listing asks for them. Consistency across platforms helps entity disambiguation (the audit's H3 finding about 5 unrelated "Dreamify" brands).

### Tagline (≤ 60 chars)
> Dashboards in minutes, not days.

### One-line description (≤ 160 chars)
> AI Data Visualization platform. Connect Meta Ads, Google Ads, GA4, TikTok, Stripe, Sheets, PostgreSQL — get decision-ready dashboards in minutes.

### Short description (≤ 300 chars)
> Dreamify is an AI Data Visualization platform that turns raw business data into decision-ready dashboards in minutes. Built for marketers, sellers, and founders at SMEs. Native connectors for Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase, Stripe, Google Sheets, and PostgreSQL.

### Long description (≤ 1,000 chars)
> Dreamify turns raw data into decision-ready dashboards in minutes — no formulas, no BI setup, no data team required. Connect Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase, Stripe, Google Sheets, and PostgreSQL in one click. Describe the dashboard you want in plain language and Dreamify generates it with the right metrics, chart types, and breakdowns. Schedule reports and anomaly alerts directly into Slack, Telegram, Zalo, or WhatsApp. Reply to any dashboard to ask a follow-up question in natural language. Built for marketers, sellers, founders, and operators at SMEs — the teams that need answers from data without a BI specialist. Pricing: Sandbox free with 100 credits per month; Pro $15 per month with unlimited connectors; Team $18 per seat per month.

### Category
> AI Data Visualization · Business Intelligence · Marketing Analytics · Dashboards

### Brand handles
- LinkedIn company: https://www.linkedin.com/company/dreamify
- X (Twitter): @dreamify_dev (https://x.com/dreamify_dev)
- Discord: https://discord.gg/GhFjdbgdxd
- Facebook page: https://www.facebook.com/profile.php?id=61587411536040
- Email: dreamify.dev@gmail.com
- Domain (product): https://app.dreamify.dev
- Founded: 2024
- HQ: Ho Chi Minh City, Vietnam

### Key talking points (pick 3–5 per listing)
- Generates dashboards in minutes instead of days
- AI describes → builds → schedules; no SQL, no BI specialist
- Native connectors: Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase, Stripe, Sheets, PostgreSQL
- Workspace-native: Slack, Telegram, Zalo, WhatsApp delivery
- Anomaly alerts + scheduled reports + reply-to-ask follow-up Q&A
- Built for non-technical marketers, sellers, founders, and operators
- Predictable SME pricing — no per-feature surprises

### Logo / asset URLs (from the deployed site)
- Logo (square, 512px): https://app.dreamify.dev/logo-main.png
- Logo (full, horizontal): https://app.dreamify.dev/logo-full-horizon.png
- OG image (1200x630): https://app.dreamify.dev/og-image.png
- Favicon: https://app.dreamify.dev/logo-favicon.png

---

## 1. Google Search Console — verify + submit sitemap

**Why:** Indexing and rank monitoring start here. Without this, the post-deploy work is invisible.

**Owner:** Founder or whoever owns the production DNS.

**URL:** https://search.google.com/search-console

### Steps

1. Sign in with a Google account that should own this property long-term (not a personal account that might leave).
2. Click **Add property** → pick **URL-prefix property** → enter `https://app.dreamify.dev`.
3. Choose a verification method:
   - **DNS TXT record** (recommended, durable): add the TXT record GSC shows to your DNS for `app.dreamify.dev`, wait 5 minutes, click Verify.
   - **HTML file**: download the `googleXXXXXX.html` file GSC provides, place it at `frontend/public/googleXXXXXX.html`, redeploy, then click Verify. The file will be served at `https://app.dreamify.dev/googleXXXXXX.html`.
4. After verification, go to **Sitemaps** in the left nav.
5. Submit `sitemap.xml` (paste exactly that — GSC will resolve to `https://app.dreamify.dev/sitemap.xml`).
6. Wait for status to flip to **Success** (usually within an hour).

### Request indexing for the top routes

Go to **URL Inspection** in the left nav. For each of these, paste the URL, then click **Request Indexing**:

```
https://app.dreamify.dev/
https://app.dreamify.dev/landingpage
https://app.dreamify.dev/pricing
https://app.dreamify.dev/about
https://app.dreamify.dev/integrations/meta-ads
https://app.dreamify.dev/integrations/google-ads
https://app.dreamify.dev/integrations/ga4
https://app.dreamify.dev/workspaces/slack
https://app.dreamify.dev/vs/julius-ai
https://app.dreamify.dev/vs/looker-studio
```

GSC limits manual indexing requests to ~10 per day. Don't try to submit the whole sitemap manually — the sitemap submission above handles bulk discovery.

### Validation checks once verified

- **Coverage → Indexed pages** should rise above 1 within 7–14 days (audit baseline = 1).
- **URL Inspection → Test Live URL** on `/landingpage` should show rendered HTML with the per-page title.

---

## 2. Bing Webmaster Tools — verify + submit sitemap

**Why:** Bing also powers ChatGPT, Copilot, and DuckDuckGo search. Skipping Bing is leaving AI-citation surface on the table.

**Owner:** Same person as GSC.

**URL:** https://www.bing.com/webmasters

### Steps

1. Sign in with a Microsoft account.
2. Click **Import sites from Google Search Console** (easiest — pulls verification + sitemap from GSC) OR add manually.
3. If manual: add `https://app.dreamify.dev`, verify with DNS TXT or the HTML file Bing provides.
4. Go to **Sitemaps** → submit `https://app.dreamify.dev/sitemap.xml`.
5. Use **IndexNow** integration (optional but free) — Bing also offers instant indexing via IndexNow protocol.

---

## 3. G2 — list product + petition new category

**Why:** G2 is a top citation source for ChatGPT, Perplexity, and review-driven SaaS evaluation. Per the audit's H3 finding, G2 presence resolves AI brand disambiguation.

**Owner:** Marketing / Founder.

**URL:** https://sell.g2.com/get-listed/

### Steps

1. Click **Get listed** and complete the vendor signup flow.
2. Verify the company by domain (`app.dreamify.dev`) and a corporate email if available.
3. Fill out the product profile using the canonical copy from Section 0.
4. Pick categories — start with these existing G2 categories:
   - **Analytics Platforms**
   - **Business Intelligence Platforms**
   - **Marketing Analytics**
   - **Embedded Business Intelligence Software**
5. After the basic listing is live, contact G2 Research at category-research@g2.com and **petition for a new "AI Data Visualization" subcategory** with this email template:

### Email template — G2 new category petition

> Subject: New category petition — AI Data Visualization
>
> Hello G2 Research team,
>
> We're requesting consideration of a new subcategory within Analytics Platforms: **AI Data Visualization**.
>
> Distinct from traditional Business Intelligence platforms and from AI Data Analysts (chat-based), AI Data Visualization tools share a specific shape: AI-generated, persistent dashboards from live data sources, with workspace delivery (Slack, Telegram, WhatsApp). The end user is the non-technical marketer, founder, or operator — not the data analyst.
>
> Vendors we believe fit this category:
> - Dreamify (https://app.dreamify.dev)
> - Looker Studio (in part — AI-assisted features)
> - Other vendors are emerging.
>
> Customer signal: market searches for "AI dashboard generator" and "AI data visualization" have grown materially in the past 12 months. The category name "AI Data Visualization" is not yet owned by any directory taxonomy.
>
> Please let us know what evidence (search volume data, buyer interviews, vendor count) would help advance this petition.
>
> Best,
> [Your name] · [Role] · Dreamify

### Reviews

Don't run incentivized review campaigns — G2 detects and penalizes these. Instead, ask 3–5 happy customers via in-app prompt or one-to-one email after a successful onboarding milestone. The audit's "no fake reviews" warning is real.

---

## 4. Capterra (and the Gartner Digital Markets network)

**Why:** Capterra + GetApp + Software Advice share the same listing. One submission, three directories.

**Owner:** Marketing.

**URL:** https://www.capterra.com/vendors/sign-up

### Steps

1. Sign up as a vendor with a corporate email.
2. Submit the product profile using the canonical copy.
3. Categories: **Business Intelligence Software**, **Dashboard Software**, **Reporting Software**, **Analytics Software**.
4. Upload screenshots — use the dashboard examples from `frontend/public/`:
   - `dark-aethetic-preview.png`
   - `light-aethetic-preview.png`
   - `Projectcard-image-1.png`
5. Listing typically goes live within 7–10 business days after Capterra's editorial review.

---

## 5. Product Hunt — schedule launch

**Why:** Product Hunt drives a spike of signups, backlinks, and PR cycle. Per the action plan, schedule for a Tuesday launch about 3 weeks out from when you start prep.

**Owner:** Founder (must be the launch maker).

**URL:** https://www.producthunt.com/posts/new

### Pre-launch prep (do at least 2 weeks before launch day)

1. Make sure the founder's PH profile is filled out (real photo, bio, social links).
2. Build a 20–40 person "supporter list" — people who agreed in advance to upvote and comment on launch day. Email them the night before with the exact link.
3. Prepare assets:
   - **Tagline** (60 char): `Dashboards in minutes, not days.`
   - **Description**: use the long description from Section 0.
   - **Gallery**: 5–7 dashboard screenshots + the [og-image.png](public/og-image.png).
   - **Promo video** (optional but doubles upvote rate): 30–60s product demo. Reuse [video-demo-main.mp4](public/video-demo-main.mp4) if available.
   - **Maker comment** drafted in advance — see template below.
4. Pick "AI Data Visualization" as the tag (Product Hunt does allow custom tags — submit and let mods adjust).

### Launch day

- Launch posts at 12:01 AM Pacific. Submit at exactly that minute for maximum visibility.
- Comment as the maker within the first 5 minutes with the prepared text.
- Email supporter list at 6 AM Pacific.
- Reply to every comment within 30 minutes through the first 12 hours.

### Maker comment template

> Hey Product Hunt 👋
>
> I'm [Founder Name], maker of Dreamify.
>
> We built Dreamify because building a marketing dashboard shouldn't take a week. Most SMEs we talked to spend 5–10 hours every Friday pulling data from Meta Ads, Google Ads, GA4, and TikTok into spreadsheets — then screenshotting charts into Slack. By Monday morning, the data is already stale.
>
> Dreamify turns the whole thing into minutes. Connect your sources, describe the dashboard, and it's built. Schedule it to deliver itself to Slack, Telegram, Zalo, or WhatsApp. Reply to ask a follow-up question and get a new chart in-thread.
>
> What we'd love your feedback on:
> – Does the "describe the dashboard you want" flow work the way you expect?
> – Which connector should we build next?
> – Anything about pricing that's confusing?
>
> Sandbox is free. Pro is $15/mo. Team is $18/seat.
>
> Thanks for being here today 🙌

---

## 6. There's an AI for that

**URL:** https://theresanaiforthat.com/submit/

**Owner:** Marketing.

**Steps:**

1. Submit the product with the canonical short description.
2. Category: **Data analysis** + **Dashboards** + **Business intelligence**.
3. Tags to include: `ai data visualization`, `dashboard generator`, `marketing analytics`, `slack`, `business intelligence`.
4. Upload the OG image as the hero.

There's an AI for that drives strong organic referral traffic and is cited by AI engines.

---

## 7. Futurepedia

**URL:** https://www.futurepedia.io/submit-tool

**Owner:** Marketing.

**Steps:**

1. Submit using the canonical short description.
2. Category: **Data Analytics** + **Business Intelligence**.
3. Pricing tier: "Freemium" (because of Sandbox).
4. Upload the OG image and 2–3 dashboard screenshots.

---

## 8. LinkedIn company page

**Why:** Most B2B evaluators check LinkedIn before signing up. Empty LinkedIn = trust signal absent.

**Owner:** Founder + marketing.

**URL:** https://www.linkedin.com/company/setup/new/

### Steps if a page doesn't exist yet

1. Create a Company Page (not a Showcase page).
2. **Name:** Dreamify
3. **Tagline:** Dashboards in minutes, not days.
4. **About** (paste the long description from Section 0).
5. **Website:** https://app.dreamify.dev
6. **Industry:** Computer Software
7. **Company size:** 2–10 employees (or actual)
8. **Headquarters:** Ho Chi Minh City, Vietnam
9. **Founded:** 2024
10. **Specialties** (paste as comma-separated): AI data visualization, automated dashboards, business intelligence, marketing analytics, SaaS, AI dashboards, Slack integration, marketing dashboard automation
11. Upload logo (square, 300×300+) and cover photo (1128×191, use a dashboard screenshot).

### Ongoing

- Founder + team should connect personal LinkedIn profiles to the company page (Experience → Add).
- Post 2–3× per week: product updates, customer wins (anonymized if no permission), thought leadership about AI Data Visualization.
- Pin the [/landingpage](https://app.dreamify.dev/landingpage) link in About.

---

## 9. Crunchbase

**Why:** Crunchbase is the canonical source for AI engines to disambiguate company entities. Without a Crunchbase profile, AI search may conflate Dreamify with the 5 unrelated "Dreamify" brands the audit flagged.

**Owner:** Founder.

**URL:** https://www.crunchbase.com/add-new

### Steps

1. Sign up (or log in).
2. Click **Add a profile → Organization**.
3. Fill in:
   - **Name:** Dreamify
   - **Website:** https://app.dreamify.dev
   - **Description:** Use the short description from Section 0.
   - **Industries:** Artificial Intelligence, SaaS, Business Intelligence, Analytics, Marketing Analytics
   - **Founded:** 2024
   - **Headquarters:** Ho Chi Minh City, Vietnam
   - **Founders:** add the founder profile(s)
   - **Funding rounds:** add if any
4. Add the logo (Crunchbase requires it).
5. Submit for review — Crunchbase usually approves within 3–5 business days.

---

## 10. Wikidata (entity disambiguation play)

**Why:** Wikidata is the single most powerful entity-disambiguation signal for AI engines (ChatGPT, Perplexity, Google Knowledge Graph). The audit's H3 finding called this out specifically.

**Owner:** Founder or marketing.

**URL:** https://www.wikidata.org/wiki/Wikidata:Main_Page

### Steps

1. Create a Wikidata account.
2. Search for existing "Dreamify" entities — there may already be entries for the unrelated brands. Note their Q-numbers.
3. Click **Create a new item** in the left sidebar.
4. Label: **Dreamify**
5. Description: **AI Data Visualization platform**
6. Add statements (each is a property + value):
   - **instance of (P31):** business (Q4830453)
   - **industry (P452):** business intelligence (Q468999), artificial intelligence (Q11660), software as a service (Q1254596)
   - **country (P17):** Vietnam (Q881)
   - **headquarters location (P159):** Ho Chi Minh City (Q1854)
   - **inception (P571):** 2024
   - **official website (P856):** https://app.dreamify.dev
   - **official name (P1448):** Dreamify
   - **Twitter username (P2002):** dreamify_dev
   - **LinkedIn (P4264):** dreamify
7. **Disambiguation:** if the unrelated brands have entries, edit each to add a clearer description (e.g., "Dreamify the AI image generator" vs Dreamify the AI Data Visualization platform).

Wikidata entries take 1–2 weeks to propagate into AI engine knowledge bases.

---

## 11. Subreddits and forums (citation infrastructure)

**Why:** Perplexity sources 46.7% of its citations from Reddit (per the audit). HackerNews and IndieHackers are similar for SaaS founders.

**Owner:** Founder (must be authentic — not marketing).

### Subreddits to engage (NOT spam — value-first only)

- r/marketing
- r/PPC
- r/smallbusiness
- r/SaaS
- r/datascience (be present, not promotional)
- r/vietnam, r/saigon (founder community)

### Posting cadence

- **Quarterly**: one Show HN post, one Indie Hackers milestone.
- **Weekly**: 1–2 genuinely helpful comments in target subreddits without product links.
- **Monthly**: one technical or strategy post (Indie Hackers, dev.to, Spiderum for VN audience).

### Show HN template

> **Show HN: Dreamify — AI Data Visualization. Dashboards from raw data in minutes.**
>
> Hi HN. We built Dreamify to fix one specific thing: marketing teams spend 5–10 hours every Friday pulling Meta/Google/TikTok data into spreadsheets to make a weekly dashboard. By Monday the data's stale.
>
> Dreamify lets you connect each source once, describe the dashboard you want in plain English, and ship it. Then schedule it to Slack/Telegram/Zalo/WhatsApp.
>
> Native connectors: Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase, Stripe, Google Sheets, PostgreSQL.
>
> Sandbox is free. Pro is $15/mo. Team is $18/seat.
>
> A few things we'd love feedback on:
> – How does the "describe the dashboard" flow feel? Where does it fail?
> – Which data source is missing from the connector list for your stack?
> – Anything in the comparison vs Looker Studio / Power BI / Julius AI you'd push back on?
>
> Happy to dig into anything technical or pricing-related in comments.

---

## 12. Discord / Slack communities (slow-cook authority)

**Why:** Niche communities convert better per impression than Reddit. Pick 3–5 and be a useful presence.

**Owner:** Founder + Growth.

### Communities to join (do NOT post product links until you're known)

- **Demand Curve** (paid Slack — strong B2B SaaS audience)
- **The Marketing Meetup** (Discord, free)
- **MeasureCamp Slack** (analytics practitioners)
- **The Marketing Operators** (Slack)
- **VN founder communities**: Founder.vn, GeekUp Slack/Telegram
- **r/SaaS Discord**
- **Indie Hackers Discord**

### Engagement rule

For every 1 product mention, contribute 10 substantive non-promotional posts. Otherwise you'll be banned or muted. Authority compounds; spam evaporates.

---

## 13. Vietnam-specific (per pitchdeck beachhead strategy)

**Why:** Vietnam is the beachhead market. These channels are uncontested in Vietnamese SERP and AI engines.

**Owner:** Growth lead (Quang).

| Channel | Action |
|---|---|
| **VnExpress, Cafef, Brands Vietnam** | Pitch the founder as a thought-leadership op-ed contributor. Two articles per quarter on AI for SMEs. |
| **Vietnam Innovators podcast** | Pitch founder appearance. Email: contact via their site. |
| **Spiderum** | Publish one long-form founder essay per month in Vietnamese. |
| **Viblo** | Publish one technical post per month (Vietnamese tech blog). |
| **Zalo Official Account** | Create OA for Dreamify, publish 2 posts/week. |
| **Facebook Vietnam business community groups** | Soft engagement (no spam) in Vibrand, GeekUp, Founder.vn groups. |
| **YouTube Vietnam** | Short-form dashboard demos in Vietnamese — 1 video/week. |

The Zalo OA is particularly high-leverage: most VN SMEs follow OAs for ops content, and no BI vendor has an OA presence yet.

---

## 14. Workspace marketplaces (when integrations ship publicly)

**Why:** Each marketplace has its own search/discovery surface. Slack App Directory, Telegram Bot Directory, Zalo Mini App Store, etc.

**Owner:** Engineering + Marketing.

Per the action plan, these have their own implementation/listing prep effort. Slack and Telegram listings are highest priority because the integrations are already live.

### Slack App Directory

**URL:** https://api.slack.com/apps → **Manage Distribution**

1. Complete the app distribution checklist (icon, screenshots, OAuth scopes documented).
2. Submit for review (Slack reviews within 7–14 business days).
3. Once approved, the app appears in https://slack.com/apps and is searchable.
4. Listing title: `Dreamify — AI Data Visualization`
5. Short description (use canonical Section 0 copy).

### Telegram Bot Directory

Telegram doesn't have a centralized directory the same way, but @BotFather lets you set the bot's description, about text, and commands. Make sure:
- Bot username: `@dreamify_bot` (or whatever is registered)
- Description, about, and commands are filled in using canonical copy.

### Zalo Mini App Store

**URL:** https://developers.zalo.me/

1. Register as a Zalo developer.
2. Submit a Mini App (Dreamify dashboard viewer).
3. Localize title and description in Vietnamese.

### WhatsApp Business Catalog

WhatsApp doesn't have a true "directory" — but make sure the WhatsApp Business profile has the canonical short description and the website link.

---

## 15. Validation checklist (run weekly for the first 60 days)

| Check | URL | What to expect |
|---|---|---|
| GSC Coverage > Valid | Search Console | Rising past 1, target 30+ by month 3 |
| GSC Performance > Total impressions | Search Console | First non-brand impressions within 7–14 days |
| Schema validity | https://validator.schema.org/?url=https://app.dreamify.dev/landingpage | No errors |
| Rich Results | https://search.google.com/test/rich-results | FAQPage eligible on `/landingpage` |
| OG card preview | https://www.opengraph.xyz/?url=https://app.dreamify.dev/vs/julius-ai | Per-route title shown |
| `site:app.dreamify.dev` query | https://www.google.com/search?q=site%3Aapp.dreamify.dev | Indexed page count |
| `site:app.dreamify.dev "AI Data Visualization"` | Google | Confirms category-anchor keyword indexed |

---

## 16. Priority order (if you can only do five things)

1. **GSC verification + sitemap submission** (Section 1) — the foundation
2. **LinkedIn company page** (Section 8) — every B2B evaluator checks
3. **Crunchbase + Wikidata** (Sections 9 + 10) — entity disambiguation; fixes the audit's "5 unrelated Dreamify brands" problem
4. **Product Hunt launch** (Section 5) — discrete spike + lasting backlink + community
5. **G2 listing + category petition** (Section 3) — citation source for AI engines

Everything else is incremental compound interest. Don't try to do all 16 sections at once.

---

## 17. What to do if a listing rejects you

- **G2 / Capterra**: usually needs more product detail or a corporate email. Resubmit with a `@dreamify.dev` or `@dreamify.com` email if possible.
- **Crunchbase**: rejections are usually about insufficient sources. Add press mentions, the LinkedIn page, and the Product Hunt launch URL.
- **Product Hunt**: launches don't get "rejected" but can get hidden if PH thinks the upvote pattern is gamed. Don't buy upvotes.
- **Wikidata**: items can be merged or deleted if they look like advertising. Keep statements neutral and factual — no marketing language in descriptions.

---

## 18. Files referenced from this runbook

- [public/sitemap.xml](public/sitemap.xml) — submit to GSC and Bing
- [public/robots.txt](public/robots.txt) — already references the sitemap
- [public/llms.txt](public/llms.txt) — LLM entry-point manifest (no submission needed; just exists)
- [index.html](index.html) — JSON-LD blocks land in here; validate post-deploy
- [SEO-PRERENDER-DEPLOY.md](SEO-PRERENDER-DEPLOY.md) — companion runbook for the prerender deploy
