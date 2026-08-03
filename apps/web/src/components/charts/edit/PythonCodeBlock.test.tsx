import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PythonCodeBlock } from "./PythonCodeBlock";

describe("PythonCodeBlock", () => {
  it("renders Python with VS Code-style syntax highlighting", () => {
    const markup = renderToStaticMarkup(
      <PythonCodeBlock python={"# load data\nimport pandas as pd\nname = 'Dreamify'"} />,
    );

    expect(markup).toContain("color:#6a9955");
    expect(markup).toContain("color:#569CD6");
    expect(markup).toContain("color:#ce9178");
    expect(markup).toContain("Copy");
  });

  it("keeps pandas-like output as preformatted text", () => {
    const output = "Date_parsed  Sessions\n2026-05-29         7";
    const markup = renderToStaticMarkup(
      <PythonCodeBlock python="print(df)" output={output} />,
    );

    expect(markup).not.toContain("<table");
    expect(markup).toContain("Date_parsed  Sessions");
  });
});
