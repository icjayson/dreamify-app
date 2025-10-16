import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export function MissionSection() {
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
          className={`text-2xl md:text-4xl font-medium tracking-tight transition-all duration-700 ease-out ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
          style={{ transitionDelay: "0ms" }}
        >
          We believe
        </h1>

        <h1
          className={`mt-2 text-5xl md:text-8xl font-medium font-instrument-serif tracking-tight transition-all duration-700 ease-out ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
          style={{ transitionDelay: "80ms" }}
        >
          Dashboard should <span className="line-through decoration-white decoration-8 italic">static</span> motion
        </h1>

        <h2
          className={`mt-12 text-xl md:text-2xl font-regular text-white/70 transition-all duration-700 ease-out ${
            isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-[120px]"
          }`}
          style={{ transitionDelay: "160ms" }}
        >
          From raw data to cinematic insight — for anyone, in minutes.
        </h2>

        <p
          className={`max-w-3xl mx-auto mt-6 text-base italic md:text-lg leading-relaxed text-white/50 transition-all duration-700 ease-out ${
            isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-[-120px]"
          }`}
          style={{ transitionDelay: "240ms" }}
        >
          Dreamify reimagines data storytelling. No more dashboards that sit still — we turn every number into a living narrative you can see, feel, and share instantly.
        </p>

        <div
          className={`mt-24 transition-all duration-700 ease-out ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
          style={{ transitionDelay: "320ms" }}
        >
          <Link
            to="/waitlist"
            className="button-gradient px-6 py-3 rounded-lg inline-flex items-center justify-center group"
          >
            <span>Join waitlist</span>
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


