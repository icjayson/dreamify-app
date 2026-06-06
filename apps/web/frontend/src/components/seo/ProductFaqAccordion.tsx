import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

type ProductFaqItem = {
  question: string;
  answer: string;
};

type ProductFaqAccordionProps = {
  headingId: string;
  title: string;
  description: string;
  items: ProductFaqItem[];
};

export function ProductFaqAccordion({
  headingId,
  title,
  description,
  items,
}: ProductFaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="relative px-5 pb-16 sm:px-8" aria-labelledby={headingId}>
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200/75 bg-white/70 p-5 shadow-[0_18px_54px_rgba(15,23,42,0.10)] backdrop-blur-2xl sm:p-8 dark:border-white/12 dark:bg-zinc-950/56">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Product FAQ
          </p>
          <h2 id={headingId} className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl dark:text-white">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {description}
          </p>
        </div>

        <div className="mt-7 space-y-3">
          {items.map((item, index) => {
            const isOpen = openIndex === index;
            const panelId = `${headingId}-panel-${index}`;

            return (
              <div
                key={item.question}
                className={cn(
                  "overflow-hidden rounded-xl border border-slate-200/75 bg-white/58 shadow-sm backdrop-blur-xl transition-colors dark:border-white/10 dark:bg-white/6",
                  isOpen && "border-primary/35 bg-primary/5 dark:border-primary/40 dark:bg-primary/10",
                )}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left sm:px-5"
                >
                  <span className="text-base font-bold leading-6 text-slate-950 sm:text-lg dark:text-white">
                    {item.question}
                  </span>
                  <span
                    className={cn(
                      "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border transition-colors",
                      isOpen
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-slate-200/80 bg-white/70 text-slate-500 hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/8 dark:text-slate-300",
                    )}
                  >
                    {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                </button>
                <div
                  id={panelId}
                  className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="space-y-3 px-4 pb-5 sm:px-5">
                      {item.answer.split("\n\n").map((paragraph) => (
                        <p key={paragraph} className="text-sm leading-7 text-slate-600 sm:text-[15px] dark:text-slate-300">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
