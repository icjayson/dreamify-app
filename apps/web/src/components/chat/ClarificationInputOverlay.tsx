import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, Info, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  getClarificationKeyboardAction,
  getClarificationOptionDetails,
  getDefaultClarificationOptionId,
  moveClarificationSelection,
} from "@/components/chat/clarificationOverlayUtils";
import type {
  ClarificationAnswer,
  ClarificationOption,
  ClarificationRequest,
} from "@/types/message";

interface ClarificationInputOverlayProps {
  requests: ClarificationRequest[];
  disabled?: boolean;
  onDismiss?: () => Promise<void> | void;
  onSubmit: (answers: ClarificationAnswer[]) => Promise<void> | void;
}

export function ClarificationInputOverlay({
  requests,
  disabled,
  onDismiss,
  onSubmit,
}: ClarificationInputOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [answers, setAnswers] = useState<Record<string, ClarificationAnswer>>({});
  const [freeText, setFreeText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const submitInFlightRef = useRef(false);

  const request = requests[currentStep];
  const isLastStep = currentStep === requests.length - 1;
  const isMultiStep = requests.length > 1;
  const defaultOptionId = useMemo(
    () => (request ? getDefaultClarificationOptionId(request.options) : undefined),
    [request],
  );
  const recordedAnswer = request ? answers[request.clarification_id] : undefined;
  const [selectedId, setSelectedId] = useState<string | undefined>(defaultOptionId);

  // Restore the saved selection when stepping back/forward, else use the default.
  useEffect(() => {
    setSelectedId(recordedAnswer?.option.id ?? defaultOptionId);
    setFreeText(recordedAnswer?.freeText ?? "");
  }, [request?.clarification_id, defaultOptionId, recordedAnswer]);

  useEffect(() => {
    overlayRef.current?.focus();
  }, [request?.clarification_id]);

  const selectedOption = request?.options.find((option) => option.id === selectedId);
  const isBusy = disabled || isSubmitting || isDismissing;

  const advanceOrSubmit = async (option: ClarificationOption) => {
    if (!request || isBusy || submitInFlightRef.current) return;
    const note = freeText.trim() || undefined;
    const nextAnswers: Record<string, ClarificationAnswer> = {
      ...answers,
      [request.clarification_id]: { request, option, freeText: note },
    };
    setAnswers(nextAnswers);
    setSelectedId(option.id);

    if (!isLastStep) {
      setDirection(1);
      setCurrentStep((step) => step + 1);
      return;
    }

    // Final step: submit every collected answer in one payload.
    const ordered = requests
      .map((req) => nextAnswers[req.clarification_id])
      .filter((answer): answer is ClarificationAnswer => Boolean(answer));
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      await onSubmit(ordered);
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedOption) return;
    await advanceOrSubmit(selectedOption);
  };

  const handleBack = () => {
    if (isBusy || currentStep === 0) return;
    setDirection(-1);
    setCurrentStep((step) => step - 1);
  };

  const handleDismiss = async () => {
    if (isBusy) return;
    setIsDismissing(true);
    try {
      await onDismiss?.();
    } finally {
      setIsDismissing(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!request) return;
    const action = getClarificationKeyboardAction({
      key: event.key,
      isNoteFocused: event.target instanceof HTMLTextAreaElement,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    });

    if (action === "none") return;
    event.preventDefault();
    event.stopPropagation();

    if (action === "previous") {
      setSelectedId((current) => moveClarificationSelection(request.options, current, -1));
    } else if (action === "next") {
      setSelectedId((current) => moveClarificationSelection(request.options, current, 1));
    } else if (action === "dismiss") {
      void handleDismiss();
    } else {
      void handleSubmit();
    }
  };

  if (!request) return null;

  return (
    <div
      ref={overlayRef}
      tabIndex={0}
      role="group"
      aria-label={request.question}
      onKeyDown={handleKeyDown}
      className="outline-none"
    >
      <div className="flex max-h-[min(54vh,25rem)] flex-col rounded-lg bg-background text-foreground">
        <div className="border-b border-border/60 px-3 py-2">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-sm font-semibold leading-5">{request.question}</div>
                {isMultiStep && (
                  <span className="flex-shrink-0 text-[11px] font-medium text-muted-foreground">
                    Question {currentStep + 1} of {requests.length}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-4 text-muted-foreground">
                <motion.span
                  animate={{ backgroundPosition: ["200% 50%", "-200% 50%"] }}
                  transition={{
                    duration: 4.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                    repeatDelay: 0.25,
                  }}
                  className="relative overflow-hidden bg-gradient-to-r from-muted-foreground/50 via-foreground to-muted-foreground/50 bg-clip-text text-transparent [background-size:260%_100%] dark:via-white"
                >
                  Asking question
                </motion.span>
                <span>Choose one option to continue. Dreamify will not guess.</span>
              </div>
              {isMultiStep && (
                <div className="mt-1.5 flex gap-1">
                  {requests.map((req, index) => (
                    <span
                      key={req.clarification_id}
                      className={cn(
                        "h-1 flex-1 rounded-full transition-colors",
                        index < currentStep && "bg-primary/70",
                        index === currentStep && "bg-primary",
                        index > currentStep && "bg-muted",
                      )}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2 chat-scrollbar-hide">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={request.clarification_id}
              custom={direction}
              initial={{ opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -24 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="space-y-1"
            >
              {request.options.map((option, index) => {
                const isSelected = option.id === selectedId;
                const details = getClarificationOptionDetails(option);
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={isBusy}
                    onClick={() => void advanceOrSubmit(option)}
                    className={cn(
                      "group flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors outline-none",
                      "hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-70",
                      isSelected && "bg-muted text-foreground",
                    )}
                  >
                    <span className="w-5 flex-shrink-0 text-xs text-muted-foreground/70">{index + 1}.</span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm font-medium leading-5">{option.label}</span>
                      {option.recommended && (
                        <span className="flex-shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          Recommended
                        </span>
                      )}
                      {details.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              role="img"
                              aria-label={`Details for ${option.label}`}
                              className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground/80 transition-colors hover:bg-background hover:text-foreground"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Info className="h-3.5 w-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="start" className="max-w-xs text-xs leading-5">
                            <div className="space-y-1">
                              {details.map((detail, detailIndex) => (
                                <div key={`${detail}-${detailIndex}`}>{detail}</div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" />}
                  </button>
                );
              })}

              {request.allow_free_text && (
                <Textarea
                  value={freeText}
                  onChange={(event) => setFreeText(event.target.value)}
                  disabled={isBusy}
                  placeholder="Add a note or clarify the direction"
                  className="mt-2 min-h-10 resize-none rounded-md py-2 text-sm"
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2.5 py-2">
          <div className="flex items-center gap-2">
            {currentStep > 0 ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={isBusy}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => void handleDismiss()}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <span>Dismiss</span>
              <kbd className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Esc</kbd>
            </button>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={!selectedOption || isBusy}
            className="h-8 rounded-md px-3.5"
          >
            {isSubmitting ? "Submitting..." : isLastStep ? "Submit" : "Next"}
            <span className="ml-1.5 text-base leading-none">↵</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
