import { BarChart3, Filter, Minus, Plus, type LucideIcon } from "lucide-react";

import type { ChartChangeSummary } from "@/types/chartEdit";

export interface ChangeChip {
  key: string;
  label: string;
  icon: LucideIcon;
  tone: "added" | "removed" | "type" | "filter";
}

export function buildChangeSummaryChips(summary: ChartChangeSummary): ChangeChip[] {
  const chips: ChangeChip[] = [];

  if (summary.chart_type_from && summary.chart_type_to) {
    chips.push({
      key: "type",
      label: `${summary.chart_type_from} → ${summary.chart_type_to}`,
      icon: BarChart3,
      tone: "type",
    });
  }

  for (const series of summary.series_added ?? []) {
    chips.push({ key: `add-${series}`, label: series, icon: Plus, tone: "added" });
  }
  for (const series of summary.series_removed ?? []) {
    chips.push({ key: `remove-${series}`, label: series, icon: Minus, tone: "removed" });
  }
  for (const filter of summary.filters_applied ?? []) {
    chips.push({ key: `filter-${filter}`, label: filter, icon: Filter, tone: "filter" });
  }

  return chips;
}
