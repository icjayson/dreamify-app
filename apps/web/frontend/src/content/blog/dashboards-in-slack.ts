import type { BlogPost } from "./types";

export const post: BlogPost = {
  slug: "dashboards-in-slack",
  title: "From Spreadsheet to Slack: Dashboards That Live Where You Work",
  description:
    "Why dashboards belong in Slack (and Telegram, Zalo, WhatsApp) — not in a separate BI portal nobody checks.",
  targetKeyword: "slack dashboard automation",
  persona: "Ops",
  publishedAt: "2026-06-06",
  updatedAt: "2026-06-06",
  author: "Dreamify Team",
  sections: [
    {
      heading: "The portal problem",
      paragraphs: [
        "BI portals have a usage problem. Adoption studies routinely show that 80% of dashboards built in BI tools are opened fewer than five times. Once the novelty fades, no one logs in to check.",
        "The data hasn't gotten worse. The dashboards are usually fine. The problem is the location: they're in a tab nobody opens.",
      ],
    },
    {
      heading: "Where attention actually lives",
      paragraphs: [
        "Your team's attention lives in Slack. Or Telegram. Or Zalo. Or WhatsApp. The number of tabs your team will actually check daily is small — and the BI portal is rarely on the list.",
        "The fix is to move the dashboards to the surface that already has the attention.",
      ],
    },
    {
      heading: "What 'in Slack' actually means",
      paragraphs: [
        "It means a scheduled chart image posted to the right channel every morning. It means an anomaly alert pinging when something breaks. It means replying to a dashboard message and getting a follow-up answer in-thread.",
        "It doesn't mean a link to the BI portal that nobody clicks.",
      ],
    },
    {
      heading: "What this changes",
      paragraphs: [
        "When dashboards live in the chat, decisions move faster. Marketers see a CPM spike before lunch, not on Friday's report. Founders catch revenue dips on Monday, not at the end of the month. The data starts driving the conversation instead of trailing it.",
      ],
    },
  ],
};

export default post;
