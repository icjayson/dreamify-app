import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export function FinanceMissionSection({ ctaText = "Audit My Cashflow", ctaLink = "/login" }: { ctaText?: string; ctaLink?: string }) {
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
    <section className="relative min-h-screen w-full flex items-center justify-center">
      <div ref={rootRef} className="max-w-6xl mx-auto px-6 text-center">
        <h1
          className={`text-2xl md:text-4xl font-medium tracking-tight transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          style={{ transitionDelay: "0ms" }}
        >
          Revenue is Vanity.
        </h1>

        <h1
          className={`mt-2 text-5xl md:text-8xl font-medium font-instrument-serif tracking-tight transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          style={{ transitionDelay: "80ms" }}
        >
          Profit is Sanity.
        </h1>

        <h2
          className={`mt-12 text-xl md:text-2xl font-regular text-white/70 transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-[120px]"
            }`}
          style={{ transitionDelay: "160ms" }}
        >
          Cashflow is Reality.
        </h2>

        <p
          className={`max-w-3xl mx-auto mt-6 text-base italic md:text-lg leading-relaxed text-white/50 transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-[-120px]"
            }`}
          style={{ transitionDelay: "240ms" }}
        >
          Don't fly blind. Dreamify acts as your AI Virtual CFO — connecting to your accounting data to forecast runway, detect budget leaks, and optimize unit economics instantly.
        </p>

        <div
          className={`mt-24 transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          style={{ transitionDelay: "320ms" }}
        >
          <Link
            to={ctaLink}
            className="button-gradient px-6 py-3 rounded-lg inline-flex items-center justify-center group"
          >
            <span>{ctaText}</span>
            <span
              aria-hidden="true"
              className="w-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:w-4 group-hover:opacity-100 group-hover:ml-2"
            >
              →
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}


