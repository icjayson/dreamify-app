import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@/lib/navigation";
import { useUser } from "@/lib/clerk";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, Home, Loader2, Send, Sparkles } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";
import WaveBackground from "@/ui/lightswind/wave-background";
import VideoBackground from "@/components/homepage-section/VideoBackground";
import { Button } from "@/components/ui/button";
import { feedbackService, type OverallFeedbackPayload } from "@/services/feedbackService";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

type FeedbackAnswers = Omit<OverallFeedbackPayload, "website">;

type Question =
  | { id: keyof FeedbackAnswers; type: "text" | "email" | "textarea"; title: string; required: true; placeholder: string }
  | { id: keyof FeedbackAnswers; type: "rating"; title: string; required: true }
  | { id: string; type: "section"; title: string; description: string };

const QUESTIONS: Question[] = [
  { id: "full_name", type: "text", title: "Full name", required: true, placeholder: "Type your answer here..." },
  { id: "email", type: "email", title: "What is your email?", required: true, placeholder: "name@example.com" },
  {
    id: "overall-section",
    type: "section",
    title: "Overall rating for the Dreamify dashboard",
    description: "A few quick ratings help us understand the experience as a whole.",
  },
  { id: "overall_rating", type: "rating", title: "Overall rating for the Dreamify dashboard (1-5)", required: true },
  { id: "visual_appeal_rating", type: "rating", title: "How visually appealing do you find Dreamify's dashboard visualization?", required: true },
  { id: "metrics_insights_rating", type: "rating", title: "How well does the dashboard provide the metrics and insights you need?", required: true },
  {
    id: "features-section",
    type: "section",
    title: "Evaluation of Dreamify dashboard features",
    description: "Tell us how useful the core dashboard workflows feel today.",
  },
  { id: "layout_editing_rating", type: "rating", title: "How useful is the dashboard's layout editing feature?", required: true },
  { id: "share_link_rating", type: "rating", title: "How useful do you find dashboard version history and export?", required: true },
  {
    id: "open-feedback-section",
    type: "section",
    title: "Feedback about features, data, and export options",
    description: "This is the space for the ideas you most want us to hear.",
  },
  {
    id: "requested_connectors",
    type: "textarea",
    title: "What additional data connector(s) would you like Dreamify to support?",
    required: true,
    placeholder: "Tell us which tools or platforms matter most...",
  },
  {
    id: "dashboard_improvements",
    type: "textarea",
    title: "What dashboard features or improvements would you like Dreamify to add?",
    required: true,
    placeholder: "Share the workflow, feature, or improvement you need...",
  },
  {
    id: "export_improvements",
    type: "textarea",
    title: "Which dashboard export or version-history improvement would help most?",
    required: true,
    placeholder: "For example: PNG, PDF, version comparison, or restore controls...",
  },
];

const INITIAL_ANSWERS: FeedbackAnswers = {
  full_name: "",
  email: "",
  overall_rating: 0,
  visual_appeal_rating: 0,
  metrics_insights_rating: 0,
  layout_editing_rating: 0,
  share_link_rating: 0,
  requested_connectors: "",
  dashboard_improvements: "",
  export_improvements: "",
};

const ANSWER_QUESTION_COUNT = QUESTIONS.filter((question) => question.type !== "section").length;

export default function OverallFeedbackPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { resolvedTheme } = useTheme();
  const [started, setStarted] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<FeedbackAnswers>(INITIAL_ANSWERS);
  const [direction, setDirection] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!user) return;
    setAnswers((current) => ({
      ...current,
      full_name: current.full_name || user.fullName || user.firstName || "",
      email: current.email || user.primaryEmailAddress?.emailAddress || "",
    }));
  }, [user]);

  const currentQuestion = QUESTIONS[questionIndex];
  const answerPosition = useMemo(
    () => QUESTIONS.slice(0, questionIndex + 1).filter((question) => question.type !== "section").length,
    [questionIndex],
  );
  const progress = submitted ? 100 : started ? Math.max(3, ((answerPosition - (currentQuestion.type === "section" ? 1 : 0)) / ANSWER_QUESTION_COUNT) * 100) : 0;

  useEffect(() => {
    if (!started || submitted || currentQuestion.type === "section") return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 260);
    return () => window.clearTimeout(timer);
  }, [currentQuestion, started, submitted]);

  const currentValue = currentQuestion.type === "section" ? "" : answers[currentQuestion.id];
  const isEmailValid = currentQuestion.type !== "email" || !String(currentValue).trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(currentValue).trim());
  const canContinue =
    currentQuestion.type === "section" ||
    (typeof currentValue === "number" ? currentValue > 0 : Boolean(String(currentValue).trim())) &&
      isEmailValid;

  const moveTo = (nextIndex: number) => {
    setError("");
    setDirection(nextIndex > questionIndex ? 1 : -1);
    setQuestionIndex(nextIndex);
  };

  const handleBack = () => {
    if (questionIndex === 0) {
      setStarted(false);
      return;
    }
    moveTo(questionIndex - 1);
  };

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await feedbackService.submitOverall({
        ...answers,
        full_name: answers.full_name.trim(),
        email: answers.email.trim(),
        requested_connectors: answers.requested_connectors.trim(),
        dashboard_improvements: answers.dashboard_improvements.trim(),
        export_improvements: answers.export_improvements.trim(),
        website: "",
      });
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We couldn't send your feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinue = () => {
    if (!canContinue || submitting) return;
    if (questionIndex === QUESTIONS.length - 1) {
      void submit();
      return;
    }
    moveTo(questionIndex + 1);
  };

  const setAnswer = (value: string | number) => {
    if (currentQuestion.type === "section") return;
    setError("");
    setAnswers((current) => ({ ...current, [currentQuestion.id]: value }));
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter") return;
    if (currentQuestion.type === "textarea") return;
    event.preventDefault();
    handleContinue();
  };

  const background = (
    <>
      {resolvedTheme === "dark" ? (
        <WaveBackground className="absolute inset-0" backdropBlurAmount="none" />
      ) : (
        <VideoBackground className="absolute inset-0" />
      )}
      <div className={cn("absolute inset-0", resolvedTheme === "dark" ? "bg-black/60" : "bg-white/35")} />
    </>
  );

  if (!started || submitted) {
    return (
      <main className="relative min-h-screen overflow-hidden text-foreground">
        {background}
        <button
          onClick={() => navigate(-1)}
          className="absolute left-5 top-5 z-20 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/15 px-3 py-2 text-sm text-white shadow-lg backdrop-blur-md transition hover:bg-black/25"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-20">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl rounded-[2rem] border border-white/20 bg-background/60 px-7 py-10 text-center shadow-2xl backdrop-blur-xl sm:px-12 sm:py-14"
          >
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
              {submitted ? <Check className="h-7 w-7" /> : <Sparkles className="h-7 w-7" />}
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
              {submitted ? `Thanks${answers.full_name ? `, ${answers.full_name.split(" ")[0]}` : ""}!` : "Help us shape the future of Dreamify"}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              {submitted
                ? "Your comments have been sent directly to our product team. They will help decide what we improve and build next."
                : "We're constantly improving Dreamify to make your workflow smoother. Your honest feedback helps us prioritize what you actually need."}
            </p>
            <Button
              onClick={() => (submitted ? navigate(user ? "/workspace" : "/") : setStarted(true))}
              className="button-gradient mt-8 h-12 rounded-xl px-7 text-base text-white"
            >
              {submitted ? <Home className="h-4 w-4" /> : null}
              {submitted ? (user ? "Back to workspace" : "Back to homepage") : "Start"}
              {!submitted ? <ArrowRight className="h-4 w-4" /> : null}
            </Button>
          </motion.div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden text-foreground">
      {background}
      <div className="absolute inset-0 bg-background/20 backdrop-blur-[2px]" />

      <div className="absolute inset-x-0 top-0 z-30 h-1 bg-white/20">
        <motion.div className="h-full bg-primary" animate={{ width: `${progress}%` }} transition={{ duration: 0.35 }} />
      </div>

      <div className="absolute left-5 right-5 top-5 z-30 flex items-center justify-between">
        <button
          onClick={handleBack}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-background/65 text-muted-foreground shadow-lg backdrop-blur-xl transition hover:bg-background/80 hover:text-foreground"
          aria-label="Previous question"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="rounded-full border border-white/20 bg-background/65 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur-xl">
          {Math.min(answerPosition, ANSWER_QUESTION_COUNT)} / {ANSWER_QUESTION_COUNT}
        </span>
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-24">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.section
            key={currentQuestion.id}
            custom={direction}
            initial={{ opacity: 0, y: direction * 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: direction * -28 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-4xl rounded-[2rem] border border-white/20 bg-background/65 px-6 py-8 shadow-2xl backdrop-blur-xl sm:px-10 sm:py-12 lg:px-14"
          >
            {currentQuestion.type === "section" ? (
              <div className="py-4 text-center sm:py-8">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-primary">Next section</p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{currentQuestion.title}</h1>
                <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">{currentQuestion.description}</p>
              </div>
            ) : (
              <>
                <div className="mb-8 flex items-start gap-3">
                  <span className="mt-1.5 flex h-6 min-w-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                    {answerPosition}
                  </span>
                  <h1 className="text-2xl font-medium leading-tight tracking-tight sm:text-4xl">
                    {currentQuestion.title}
                    {currentQuestion.required ? <span className="text-primary"> *</span> : null}
                  </h1>
                </div>

                {currentQuestion.type === "rating" ? (
                  <div>
                    <div className="grid grid-cols-5 gap-2 sm:gap-3">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          key={rating}
                          onClick={() => setAnswer(rating)}
                          className={cn(
                            "h-16 rounded-xl border text-lg font-semibold transition-all sm:h-20 sm:text-xl",
                            currentValue === rating
                              ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                              : "border-border/70 bg-background/70 text-foreground shadow-sm hover:-translate-y-0.5 hover:border-primary/60 hover:bg-primary/10",
                          )}
                        >
                          {rating}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex justify-between text-xs text-muted-foreground sm:text-sm">
                      <span>Very bad</span>
                      <span>Perfect</span>
                    </div>
                  </div>
                ) : currentQuestion.type === "textarea" ? (
                  <TextareaAutosize
                    ref={inputRef as any}
                    value={String(currentValue)}
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={currentQuestion.placeholder}
                    minRows={1}
                    maxRows={5}
                    maxLength={5000}
                    className="max-h-40 w-full resize-none overflow-y-auto border-0 border-b-2 border-primary/60 bg-transparent px-0 py-3 text-xl leading-8 text-foreground outline-none transition placeholder:text-muted-foreground/45 focus:border-primary sm:text-2xl"
                  />
                ) : (
                  <input
                    ref={inputRef as React.RefObject<HTMLInputElement>}
                    type={currentQuestion.type}
                    value={String(currentValue)}
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={currentQuestion.placeholder}
                    maxLength={currentQuestion.type === "email" ? 320 : 120}
                    className="w-full border-0 border-b-2 border-primary/60 bg-transparent px-0 py-3 text-xl text-foreground outline-none transition placeholder:text-muted-foreground/45 focus:border-primary sm:text-3xl"
                  />
                )}
              </>
            )}

            {!isEmailValid ? <p className="mt-4 text-sm text-destructive">Please enter a valid email address.</p> : null}
            {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

            <div className={cn("mt-9 flex items-center gap-3", currentQuestion.type === "section" && "justify-center")}>
              <Button
                onClick={handleContinue}
                disabled={!canContinue || submitting}
                className="button-gradient h-11 rounded-xl px-5 text-white"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : questionIndex === QUESTIONS.length - 1 ? <Send className="h-4 w-4" /> : null}
                {submitting ? "Sending..." : questionIndex === QUESTIONS.length - 1 ? "Submit" : currentQuestion.type === "section" ? "Continue" : "OK"}
              </Button>
            </div>
          </motion.section>
        </AnimatePresence>
      </div>
    </main>
  );
}
