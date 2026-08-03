import { describe, expect, it } from "vitest";

import { getSpreadsheetPreviewTarget } from "./dataContextTokens";
import type { Message } from "@/types/message";

const attachment = (overrides: Partial<NonNullable<Message["attachment"]>>): Message["attachment"] => ({
  kind: "csv",
  name: "dataset.csv",
  ...overrides,
});

describe("getSpreadsheetPreviewTarget", () => {
  it("returns a target for a CSV user attachment with files[0].id", () => {
    const target = getSpreadsheetPreviewTarget(attachment({
      files: [{ id: "asset_csv", name: "dataset.csv", ext: "csv" }],
    }));

    expect(target).toEqual({
      assetId: "asset_csv",
      filename: "dataset.csv",
      ext: "csv",
    });
  });

  it("returns a target for XLS and XLSX attachments", () => {
    expect(getSpreadsheetPreviewTarget(attachment({
      name: "daily.xlsx",
      files: [{ id: "asset_xlsx", name: "daily.xlsx", ext: "xlsx" }],
    }))).toMatchObject({ assetId: "asset_xlsx", ext: "xlsx" });

    expect(getSpreadsheetPreviewTarget(attachment({
      name: "legacy.xls",
      files: [{ id: "asset_xls", name: "legacy.xls", ext: "xls" }],
    }))).toMatchObject({ assetId: "asset_xls", ext: "xls" });
  });

  it("does not return a target for connector attachments", () => {
    expect(getSpreadsheetPreviewTarget(attachment({
      name: "ga4.csv",
      sourceType: "GA4",
      files: [{ id: "asset_ga4", name: "ga4.csv", ext: "csv", sourceType: "GA4" }],
    }))).toBeNull();

    expect(getSpreadsheetPreviewTarget(attachment({
      name: "sheet.csv",
      sourceType: "Google Sheets",
      files: [{ id: "asset_sheet", name: "sheet.csv", ext: "csv", sourceType: "Google Sheets" }],
    }))).toBeNull();

    expect(getSpreadsheetPreviewTarget(attachment({
      name: "sheet.csv",
      sourceType: "Google Sheets",
      files: [{ id: "asset_sheet", name: "sheet.csv", ext: "csv" }],
    }))).toBeNull();
  });

  it("returns the first local spreadsheet from multiple-file attachments", () => {
    expect(getSpreadsheetPreviewTarget(attachment({
      name: "2 files",
      sourceType: "Multiple",
      files: [
        { id: "asset_one", name: "one.csv", ext: "csv" },
        { id: "asset_two", name: "two.csv", ext: "csv" },
      ],
    }))).toEqual({
      assetId: "asset_one",
      filename: "one.csv",
      ext: "csv",
    });
  });

  it("skips connector files inside multiple attachments", () => {
    expect(getSpreadsheetPreviewTarget(attachment({
      name: "2 files",
      sourceType: "Multiple",
      files: [
        { id: "asset_ga4", name: "ga4.csv", ext: "csv", sourceType: "GA4" },
        { id: "asset_sheet", name: "sheet.csv", ext: "csv", sourceType: "Google Sheets" },
      ],
    }))).toBeNull();
  });

  it("falls back to project assets by attachment name", () => {
    const target = getSpreadsheetPreviewTarget(attachment({ name: "fallback.csv" }), [
      { id: "asset_fallback", name: "fallback.csv", ext: "CSV" },
    ]);

    expect(target).toEqual({
      assetId: "asset_fallback",
      filename: "fallback.csv",
      ext: "csv",
    });
  });

  it("does not fall back to connector project assets", () => {
    expect(getSpreadsheetPreviewTarget(attachment({ name: "sheet.csv" }), [
      { id: "asset_sheet", name: "sheet.csv", ext: "CSV", sourceType: "Google Sheets" },
    ])).toBeNull();
  });
});
