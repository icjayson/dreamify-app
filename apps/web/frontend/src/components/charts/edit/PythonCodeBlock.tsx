import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface PythonCodeBlockProps {
  python: string;
  /** Optional captured stdout/result rendered below the code. */
  output?: string;
}

/**
 * Reusable Python code block with a copy-to-clipboard button. Carries
 * `data-export-exclude` so PNG/WebP export skips technical details.
 */
export const PythonCodeBlock = ({ python, output }: PythonCodeBlockProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(python);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy code:", error);
    }
  };

  return (
    <div className="space-y-2" data-export-exclude>
      <div className="relative">
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-emerald-100/30 bg-zinc-800/95 px-1.5 py-1 text-[10px] font-semibold text-emerald-50 shadow-sm shadow-black/30 transition-colors hover:bg-zinc-700 hover:text-white"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        <pre className="max-h-72 overflow-auto rounded-md bg-black/80 p-2.5 pr-14 text-[11px] leading-4 text-emerald-100">
          <code>{python}</code>
        </pre>
      </div>

      {output && output.trim() && (
        <pre
          className="max-h-60 overflow-auto rounded-md bg-muted/60 p-2.5 text-[11px] leading-4 font-mono"
          style={{ color: "var(--title-color, inherit)" }}
        >
          <code>{output}</code>
        </pre>
      )}
    </div>
  );
};
