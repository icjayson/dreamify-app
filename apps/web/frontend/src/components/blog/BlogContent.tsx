import { useMemo } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

interface BlogContentProps {
  html: string;
  className?: string;
}

/**
 * Renders CMS-authored HTML. Always sanitized with DOMPurify before display
 * (defense-in-depth — even though only admins author content). Styled with
 * Tailwind Typography, which inverts automatically in dark mode.
 */
export default function BlogContent({ html, className }: BlogContentProps) {
  const clean = useMemo(
    () =>
      DOMPurify.sanitize(html || "", {
        ADD_ATTR: ["target", "rel"],
      }),
    [html],
  );

  return (
    <div
      className={cn(
        "prose prose-neutral dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-6 prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-4",
        "prose-a:text-primary prose-img:rounded-xl prose-img:my-6 prose-img:shadow-sm",
        "prose-p:leading-[1.5] prose-headings:leading-[1.5] prose-li:leading-[1.5] prose-blockquote:leading-[1.5] prose-p:my-0",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
