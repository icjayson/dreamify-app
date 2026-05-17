import type { ClarificationOption, Message } from "@/types/message";

export type ClarificationKeyboardAction =
  | "previous"
  | "next"
  | "submit"
  | "dismiss"
  | "none";

export interface ClarificationKeyboardInput {
  key: string;
  isNoteFocused?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export function getDefaultClarificationOptionId(options: ClarificationOption[]): string | undefined {
  return options.find((option) => option.recommended)?.id ?? options[0]?.id;
}

export function moveClarificationSelection(
  options: ClarificationOption[],
  selectedId: string | undefined,
  delta: -1 | 1,
): string | undefined {
  if (options.length === 0) return undefined;
  const currentIndex = Math.max(0, options.findIndex((option) => option.id === selectedId));
  const nextIndex = (currentIndex + delta + options.length) % options.length;
  return options[nextIndex]?.id;
}

export function getClarificationKeyboardAction(input: ClarificationKeyboardInput): ClarificationKeyboardAction {
  if (input.key === "ArrowUp") return "previous";
  if (input.key === "ArrowDown") return "next";
  if (input.key === "Escape") return "dismiss";
  if (input.key === "Enter" && (!input.isNoteFocused || input.metaKey || input.ctrlKey)) {
    return "submit";
  }
  return "none";
}

export function getClarificationOptionDetails(option: ClarificationOption): string[] {
  const details: string[] = [];
  const metadata = option.metadata ?? {};
  if (option.description) details.push(option.description);
  if (option.impact) details.push(`Impact: ${option.impact}`);
  if (metadata.asset_selection) details.push(`Data scope: ${metadata.asset_selection}`);
  if (Array.isArray(metadata.asset_ids) && metadata.asset_ids.length > 0) {
    details.push(`${metadata.asset_ids.length} selected data source${metadata.asset_ids.length === 1 ? "" : "s"}`);
  }
  Object.entries(metadata).forEach(([key, value]) => {
    if (["asset_selection", "asset_ids"].includes(key)) return;
    if (value === null || value === undefined || typeof value === "object") return;
    details.push(`${key}: ${String(value)}`);
  });
  return details;
}

export function getLatestPendingClarificationMessage(
  messages: Message[],
  dismissedClarificationIds: Set<string> = new Set(),
): Message | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return null;
    const clarificationId = message.clarificationRequest?.clarification_id;
    if (
      message.role === "assistant"
      && message.clarificationRequest
      && clarificationId
      && !message.clarificationResolution
      && !dismissedClarificationIds.has(clarificationId)
    ) {
      return message;
    }
  }
  return null;
}
