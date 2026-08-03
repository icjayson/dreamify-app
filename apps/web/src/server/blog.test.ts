import { describe, expect, it } from "vitest";

import { sanitizeBlogHtml } from "./blog";

describe("server-rendered blog HTML", () => {
  it("keeps editorial structure while removing active content", () => {
    const clean = sanitizeBlogHtml(
      '<h2 id="safe">Guide</h2><script>alert(1)</script><p onclick="steal()">Body</p>',
    );

    expect(clean).toBe('<h2 id="safe">Guide</h2><p>Body</p>');
  });

  it("rejects executable URLs and hardens outbound links", () => {
    const clean = sanitizeBlogHtml(
      '<a href="javascript:alert(1)" target="_blank">bad</a><a href="https://example.test">good</a>',
    );

    expect(clean).not.toContain("javascript:");
    expect(clean).toContain('href="https://example.test"');
    expect(clean).toContain('rel="noopener noreferrer"');
  });
});
