import { describe, expect, it } from "vitest";
import { conversationNodesToMessages } from "./conversationToMessages";
import { EXPLICIT_PROMPT_THEME_SOURCE } from "@/types/message";

describe("conversationNodesToMessages clarification requests", () => {
  it("restores assistant clarification request nodes", () => {
    const clarification = {
      clarification_id: "clarify_1",
      reason_code: "missing_data_context",
      question: "Choose the data context",
      options: [
        {
          id: "asset:asset_1",
          label: "GA4 Web Visitors",
          metadata: { asset_ids: ["asset_1"], asset_selection: "explicit" },
        },
      ],
      allow_free_text: true,
      required: true,
    };

    const messages = conversationNodesToMessages({
      nodes: [
        {
          node_id: "assistant_1",
          role: "assistant",
          created_at: "2026-05-16T00:00:00Z",
          contents: [
            { type: "text", data: { text: "I need one choice before I analyze." } },
            { type: "clarification_request", data: clarification },
          ],
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].clarificationRequest).toEqual(clarification);
  });

  it("folds dismissed clarification responses into the assistant question trace", () => {
    const clarification = {
      clarification_id: "clarify_1",
      reason_code: "missing_data_context",
      question: "Choose the data context",
      options: [
        {
          id: "asset:asset_1",
          label: "GA4 Web Visitors",
          metadata: { asset_ids: ["asset_1"], asset_selection: "explicit" },
        },
      ],
      allow_free_text: true,
      required: true,
    };

    const messages = conversationNodesToMessages({
      nodes: [
        {
          node_id: "assistant_1",
          role: "assistant",
          created_at: "2026-05-16T00:00:00Z",
          contents: [
            { type: "text", data: { text: "I need one choice before I analyze." } },
            { type: "clarification_request", data: clarification },
          ],
        },
        {
          node_id: "user_hidden_1",
          role: "user",
          created_at: "2026-05-16T00:01:00Z",
          metadata: { hidden: true, clarification_answer_status: "no_answer" },
          contents: [
            {
              type: "clarification_response",
              data: {
                clarification_id: "clarify_1",
                selected_option_id: null,
                answer_status: "no_answer",
                free_text: null,
              },
            },
          ],
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].clarificationResolution).toEqual({
      clarification_id: "clarify_1",
      status: "no_answer",
      question: "Choose the data context",
      resolved_at: "2026-05-16T00:01:00Z",
    });
  });
});

describe("conversationNodesToMessages theme intent", () => {
  it("does not render a user theme chip from unmarked dashboard metadata", () => {
    const messages = conversationNodesToMessages({
      nodes: [
        {
          node_id: "user_1",
          role: "user",
          created_at: "2026-05-16T00:00:00Z",
          metadata: { theme_id: "crimson", analysis_focus_id: "default" },
          contents: [{ type: "text", data: { text: "show last week web visitors" } }],
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].template).toBeUndefined();
  });

  it("renders a user theme chip only when the prompt marked explicit theme intent", () => {
    const messages = conversationNodesToMessages({
      nodes: [
        {
          node_id: "user_1",
          role: "user",
          created_at: "2026-05-16T00:00:00Z",
          metadata: {
            theme_id: "crimson",
            analysis_focus_id: "default",
            theme_source: EXPLICIT_PROMPT_THEME_SOURCE,
          },
          contents: [{ type: "text", data: { text: "use this theme for the dashboard" } }],
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].template?.suggestedTheme).toBe("crimson");
  });
});

describe("conversationNodesToMessages asset fallback", () => {
  const fallbackAttachment = {
    kind: "csv" as const,
    name: "4 files",
    sourceType: "Multiple",
    files: [
      {
        id: "ga4_asset",
        name: "ga4.csv",
        ext: "csv",
        sourceType: "GA4",
        propertyName: "Dreamify Web Tracking",
      },
    ],
  };

  it("does not attach restored project assets to an asset_selection none user node", () => {
    const messages = conversationNodesToMessages({
      nodes: [
        {
          node_id: "user_1",
          role: "user",
          created_at: "2026-05-16T00:00:00Z",
          metadata: { asset_selection: "none" },
          contents: [{ type: "text", data: { text: "what is last week trend in DAU" } }],
        },
        {
          node_id: "assistant_1",
          role: "assistant",
          created_at: "2026-05-16T00:00:01Z",
          contents: [
            { type: "text", data: { text: "I need one choice before I analyze." } },
            {
              type: "clarification_request",
              data: {
                clarification_id: "clarify_1",
                reason_code: "missing_data_context",
                question: "Choose the data context",
                options: [],
              },
            },
          ],
        },
      ],
    }, {
      lastUserMessageAttachment: fallbackAttachment,
    });

    expect(messages[0].role).toBe("user");
    expect(messages[0].attachment).toBeUndefined();
  });

  it("does not attach restored project assets to a user turn awaiting clarification even without asset metadata", () => {
    const messages = conversationNodesToMessages({
      nodes: [
        {
          node_id: "user_1",
          role: "user",
          created_at: "2026-05-16T00:00:00Z",
          contents: [{ type: "text", data: { text: "what is last week trend in DAU" } }],
        },
        {
          node_id: "assistant_1",
          role: "assistant",
          created_at: "2026-05-16T00:00:01Z",
          contents: [
            { type: "text", data: { text: "I need one choice before I analyze." } },
            {
              type: "clarification_request",
              data: {
                clarification_id: "clarify_1",
                reason_code: "missing_data_context",
                question: "Choose the data context",
                options: [],
              },
            },
          ],
        },
      ],
    }, {
      lastUserMessageAttachment: fallbackAttachment,
    });

    expect(messages[0].role).toBe("user");
    expect(messages[0].attachment).toBeUndefined();
  });

  it("keeps legacy last-user attachment fallback when asset selection metadata is absent", () => {
    const messages = conversationNodesToMessages({
      nodes: [
        {
          node_id: "user_1",
          role: "user",
          created_at: "2026-05-16T00:00:00Z",
          contents: [{ type: "text", data: { text: "build a dashboard" } }],
        },
      ],
    }, {
      lastUserMessageAttachment: fallbackAttachment,
    });

    expect(messages[0].attachment).toEqual(fallbackAttachment);
  });
});
