import type { WorkspaceContent } from "./types";
import slack from "./slack";
import telegram from "./telegram";
import zalo from "./zalo";
import whatsapp from "./whatsapp";

export const WORKSPACES: WorkspaceContent[] = [slack, telegram, zalo, whatsapp];

export const getWorkspace = (slug: string): WorkspaceContent | undefined =>
  WORKSPACES.find((w) => w.slug === slug);

export type { WorkspaceContent };
