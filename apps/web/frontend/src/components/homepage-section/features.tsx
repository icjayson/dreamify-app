import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { MessageCircle, Brain, Sparkles, ChevronRight } from "lucide-react";

type Step = {
  id: string;
  title: string;
  description: string;
  icon: any;
  videoSrc: string;
  bullets: string[];
};

export const FeaturesSection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });

  const steps: Step[] = useMemo(
    () => [
      {
        id: "conversational",
        title: "Quick Dashboard Generation",
        description: "Say 'create dashboard' to Dreamify, it analyse your data and generate desired output.",
        icon: MessageCircle,
        videoSrc: "/video-about-dashboard.mov",
        bullets: [
          "Upload your data",
          "Describe your desired dashboard output",
          "Dreamify will generate dashboard in 3 minutes",
        ],
      },
      {
        id: "insight",
        title: "Easy Layout Editation and Insight Collection",
        description: "You can edit layout and collect insights in seconds.",
        icon: Brain,
        videoSrc: "/video-about-editandinsight.mov",
        bullets: [
          "Manually edit layout or chat with Dreamify",
          "Collect instant and deep insights for each metrics",
        ],
      },
      {
        id: "visualization",
        title: "Unique Dashboard Shared Link",
        description: "You can share your dashboard with anyone in seconds.",
        icon: Sparkles,
        videoSrc: "/video-about-exportl.mov",
        bullets: [
          "Unique dashboard link",
          "Fully control the permission of dashboard link",
        ],
      },
    ],
    []
  );

  const [activeIndex, setActiveIndex] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Update video on active step change
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (activeIndex < 0) return;
    const src = steps[activeIndex]?.videoSrc;
    if (!src) return;
    if (video.getAttribute("src") !== src) {
      video.setAttribute("src", src);
    }
    video.play().catch(() => { });
  }, [activeIndex, steps]);

  const onClick = useCallback((index: number) => setActiveIndex(index), []);

  return (
    <section className="py-24 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      <div className="relative z-10 container mx-auto px-6 ">
        <div className={`text-center mb-16 tracking-tight transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
          style={{ transitionDelay: "80ms" }}>
          <h2 className="text-4xl md:text-6xl font-instrument-serif text-foreground dark:text-white">From chat to cinematic dashboard — all in one interface</h2>
          <p className="text-md text-muted-foreground dark:text-white/60 mt-2">Click to explore</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          {/* Left: Minimalist list (no outer frame), clickable rows with divider */}
          <div className={`tracking-tight transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-[-120px]"
            }`}
            style={{ transitionDelay: "160ms" }}>
            {steps.map((step, i) => {
              const Icon = step.icon;
              const active = i === activeIndex;
              return (
                <button
                  key={step.id}
                  onClick={() => onClick(i)}
                  className={`group relative w-full text-left px-3 md:px-5 lg:px-6 py-5 rounded-xl transition-all duration-300 border-b border-border ${active ? 'bg-foreground/5 dark:bg-white/5 ring-1 ring-border shadow-[0_0_20px_hsl(var(--primary)/0.3)]' : 'hover:bg-foreground/5 dark:hover:bg-white/5'
                    }`}
                  aria-current={active ? 'step' : undefined}
                >
                  {/* Active left bar */}
                  <div className={`absolute left-0 top-0 h-full w-1.5 rounded-l-sm bg-gradient-to-b from-foreground to-foreground dark:from-white dark:to-white transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`} />

                  <div className="flex items-start gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 icon-panel shadow-[0_0_20px_hsl(var(--primary)/0.3)] ring-1 ring-border rounded-md flex items-center justify-center">
                        <Icon className="w-5 h-5 text-foreground dark:text-white" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div
                        className={`h-0.5 w-full mb-3 ${active
                          ? 'bg-foreground dark:bg-white'
                          : 'bg-foreground/40 dark:bg-white/40'
                          }`}
                      />
                      <div className={`text-xl md:text-2xl font-semibold font-instrument-serif text-foreground dark:text-white`}>{step.title}</div>
                      <div className="text-sm text-foreground/90 dark:text-white/90 mt-2 leading-relaxed">{step.description}</div>
                      <div className={`overflow-hidden transition-all duration-300 ${active ? 'max-h-48 opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
                        <ul className="list-disc pl-6 text-sm text-muted-foreground dark:text-white/70 space-y-1">
                          {step.bullets.map((b, idx) => (
                            <li key={idx}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className={`mt-1 ml-2 transition-transform ${active ? 'rotate-90' : ''}`} aria-hidden>
                      <ChevronRight className="w-4 h-4 text-muted-foreground dark:text-white/70" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: Sticky demo video (click to reveal) */}
          <div className="lg:sticky lg:top-24">
            <div className={`tracking-tight transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-[120px]"
              }`}
              style={{ transitionDelay: "160ms" }}>
              <div className="rounded-2xl overflow-hidden">
                {activeIndex >= 0 ? (
                  <video
                    ref={videoRef}
                    className="w-full aspect-video object-cover bg-card/50"
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    aria-label={`Feature demo: ${steps[activeIndex]?.title}`}
                    src={steps[activeIndex]?.videoSrc}
                  />
                ) : (
                  <div className="w-full aspect-video flex items-center justify-center text-muted-foreground dark:text-white/60">
                    Click a step to preview the demo
                  </div>
                )}
              </div>
              <div className="mt-4 text-center">
                {activeIndex >= 0 ? (
                  <>
                    <div className="text-sm text-foreground/80 dark:text-white/80 font-medium">{steps[activeIndex]?.title}</div>
                    <div className="text-xs text-muted-foreground dark:text-white/60 mt-1">{steps[activeIndex]?.description}</div>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground dark:text-white/60">Select a step to see details</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};


