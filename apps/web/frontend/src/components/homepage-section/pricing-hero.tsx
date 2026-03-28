import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function PricingHeroSection({
  className,
}: {
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { root: null, threshold: 0.2 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section className={cn("relative pt-32 pb-16 w-full flex items-center justify-center", className)}>
      <div ref={rootRef} className="max-w-6xl mx-auto px-6 text-center">
        <h1
          className={`text-2xl md:text-3xl font-medium tracking-tight transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          style={{ transitionDelay: "0ms" }}
        >
          Simple Pricing
        </h1>

        <h1
          className={`mt-2 text-5xl md:text-7xl font-medium font-instrument-serif tracking-tight transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          style={{ transitionDelay: "80ms" }}
        >
          Choose the <span className="italic">perfect</span> plan for your growth
        </h1>

        <p
          className={`max-w-3xl mx-auto mt-6 text-lg md:text-xl leading-relaxed text-white/70 transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          style={{ transitionDelay: "160ms" }}
        >
          Start for free, upgrade when you're ready.
        </p>
      </div>
    </section>
  );
}
