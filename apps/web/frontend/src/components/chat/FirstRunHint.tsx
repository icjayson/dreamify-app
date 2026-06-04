import { useState } from "react";
import { Sparkles, X } from "lucide-react";

const STORAGE_KEY = "dreamify_hint_chart_fix_seen";

interface FirstRunHintProps {
    /** Only show the hint when there is a dashboard the user can reference. */
    show: boolean;
}

/**
 * Dismissible one-time hint that teaches the @-mention chart-editing flow.
 * Dismissal is persisted to localStorage so it appears at most once per browser.
 */
export function FirstRunHint({ show }: FirstRunHintProps) {
    const [dismissed, setDismissed] = useState(() => {
        try {
            return localStorage.getItem(STORAGE_KEY) === "1";
        } catch {
            return false;
        }
    });

    if (!show || dismissed) return null;

    const handleDismiss = () => {
        try {
            localStorage.setItem(STORAGE_KEY, "1");
        } catch {
            // Ignore storage failures — worst case the hint reappears next session.
        }
        setDismissed(true);
    };

    return (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-300">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="flex-1">
                Tip: type <span className="font-medium text-foreground">@</span> to reference a chart
                (or click <span className="font-medium text-foreground">Edit this chart</span> on any
                card), then describe the change in plain language.
            </span>
            <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss tip"
                className="shrink-0 rounded p-0.5 text-muted-foreground/70 hover:bg-primary/10 hover:text-foreground"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
