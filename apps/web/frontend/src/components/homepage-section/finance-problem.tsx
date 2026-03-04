import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

export const FinanceProblemSection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const navigate = useNavigate();

  const leftVideoRef = useRef<HTMLVideoElement | null>(null);
  const rightVideoRef = useRef<HTMLVideoElement | null>(null);

  const handleEnter = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return;
    video.play().catch(() => { });
  }, []);

  const handleLeave = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return;
    video.pause();
  }, []);

  return (
    <section className="py-24 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      <div className="max-w-full relative z-10 container mx-auto px-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Left - Old Way */}
          <div
            className={`group px-6 py-10 relative rounded-xl overflow-hidden transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-[-120px]"
              }`}
            style={{ transitionDelay: "160ms" }}
            onMouseEnter={() => handleEnter(leftVideoRef.current)}
            onMouseLeave={() => handleLeave(leftVideoRef.current)}
          >
            <div
              aria-hidden
              className="absolute inset-0 -z-10 bg-cover bg-center"
              style={{ backgroundImage: 'url(/background-image-2.png)' }}
            />
            <div aria-hidden className="absolute inset-0 z-10 bg-black/60 opacity-100 transition-opacity duration-300 pointer-events-none group-hover:opacity-0" />
            <div className="flex items-center justify-between gap-4 relative z-20">
              <h1 className="text-3xl md:text-4xl font-semibold font-instrument-serif text-white">The 'End-of-Month' Panic</h1>
            </div>
            <h3 className="mt-4 text-lg md:text-xl font-medium text-white relative">Too little, too late.</h3>
            <p className="mt-0 text-white/60">SMEs often realize they are out of cash only when the bank account is empty.</p>
            <div
              className="mt-20 mx-4 rounded-xl overflow-hidden hover:scale-[1.01] transition-transform duration-200"
            >
              <img
                className="w-full aspect-video object-cover"
                aria-label="Old way demo image"
                src="/old-way2.jpg"
              />
            </div>
          </div>

          {/* Right - Dreamify Way */}
          <div
            className={`group px-6 py-10 relative rounded-xl overflow-hidden transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-[120px]"
              }`}
            style={{ transitionDelay: "160ms" }}
            onMouseEnter={() => handleEnter(rightVideoRef.current)}
            onMouseLeave={() => handleLeave(rightVideoRef.current)}
          >
            <div
              aria-hidden
              className="absolute inset-0 -z-10 bg-cover bg-center"
              style={{ backgroundImage: 'url(/background-image.png)' }}
            />
            <div aria-hidden className="absolute inset-0 z-10 bg-black/60 opacity-100 transition-opacity duration-300 pointer-events-none group-hover:opacity-0" />
            <div className="flex items-center justify-between gap-4 relative z-20">
              <h1 className="text-3xl md:text-4xl font-semibold font-instrument-serif text-white">Look Forward</h1>
            </div>
            <h3 className="mt-4 text-lg md:text-xl font-medium text-white">Active. Predictive. Guided.</h3>
            <p className="mt-0 text-white/60">You can't steer a ship looking at the wake.</p>
            <div
              className="mt-20 mx-4 rounded-xl overflow-hidden hover:scale-[1.01] transition-transform duration-200"
            >
              <video
                ref={rightVideoRef}
                className="w-full aspect-video object-cover bg-card/50"
                muted
                loop
                playsInline
                preload="metadata"
                aria-label="Dreamify way demo video"
                src="/video-demo-main.mov"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


