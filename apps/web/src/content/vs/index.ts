import type { ComparisonContent } from "./types";
import juliusAi from "./julius-ai";
import lookerStudio from "./looker-studio";
import powerBi from "./power-bi";
import airbook from "./airbook";
import omni from "./omni";
import tableau from "./tableau";
import chatgptForData from "./chatgpt-for-data";

export const COMPARISONS: ComparisonContent[] = [
  juliusAi,
  lookerStudio,
  powerBi,
  airbook,
  omni,
  tableau,
  chatgptForData,
];

export const getComparison = (slug: string): ComparisonContent | undefined =>
  COMPARISONS.find((c) => c.slug === slug);

export type { ComparisonContent };
