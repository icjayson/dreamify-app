import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useNavigate } from "react-router-dom";

export const CTAContainerSection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const navigate = useNavigate();

  return (
    <section className="py-36 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      <div className="container mx-auto px-6">
        <div
          className={`relative mx-auto max-w-5xl rounded-[28px] overflow-hidden tracking-tight transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          style={{ transitionDelay: "80ms" }}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: 'url(/background-image-3.png)' }}
          />
          <div className="absolute inset-0 bg-black/60" />

          <div className="relative z-10 flex flex-col items-center text-center px-6 py-12 md:py-24">
            <h2 className="text-4xl md:text-7xl font-instrument-serif text-white tracking-tight max-w-4xl">
              Stop learning BI tools.
            </h2>
            <h2 className="mt-2 text-4xl md:text-7xl font-instrument-serif text-white tracking-tight max-w-4xl">
              Start creating dashboards that move.
            </h2>
            <p className="mt-6 max-w-2xl text-white/70 text-base md:text-lg leading-relaxed">
              Dreamify eliminates the setup, the code, and the friction. Upload your data, describe your goal, and watch your dashboard come alive, instantly.
            </p>

            <div className="mt-16 flex items-center gap-4">
              <button onClick={() => navigate('/login')} className="button-outline px-6 md:px-7 py-3 rounded-xl inline-flex items-center justify-center text-sm md:text-base group">
                <span>Log in</span>
                <span aria-hidden className="w-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:w-4 group-hover:opacity-100 group-hover:ml-2">→</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};


