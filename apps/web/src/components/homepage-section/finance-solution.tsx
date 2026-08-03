import { useRef } from "react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { MARKETING_MEDIA } from "@/constants/marketingMedia";

export const DreamifyWaySection = () => {
  const { isVisible, ref } = useIntersectionObserver({ threshold: 0.1 });
  const rightVideoRef = useRef<HTMLVideoElement | null>(null);

  const handleEnter = () => {
    if (rightVideoRef.current) rightVideoRef.current.play().catch(() => { });
  };

  const handleLeave = () => {
    if (rightVideoRef.current) rightVideoRef.current.pause();
  };

  return (
    <section className="py-24 relative overflow-hidden" ref={ref as React.RefObject<HTMLElement>}>
      <div className="max-w-4xl mx-auto px-6 text-center">
        <div
          className={`group px-6 py-10 relative rounded-xl overflow-hidden transition-all duration-700 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-cover bg-center"
            style={{ backgroundImage: 'url(/background-image.png)' }}
          />
          <div aria-hidden className="absolute inset-0 z-10 bg-black/60 opacity-100 transition-opacity duration-300 pointer-events-none group-hover:opacity-0" />

          <div className="relative z-20 flex flex-col items-center justify-center">
            <h2 className="text-4xl md:text-6xl font-instrument-serif text-white mb-6">
              Chat with your Ledger.
            </h2>
            <p className="text-xl text-white/80 max-w-2xl text-center leading-relaxed">
              Upload CSV, XLSX, XLS, or flat JSON data and ask questions in plain English. Optional accounting connectors remain unavailable until explicitly certified.
            </p>
          </div>

          <div className="mt-16 mx-4 rounded-xl overflow-hidden hover:scale-[1.01] transition-transform duration-200 shadow-2xl">
            <video
              ref={rightVideoRef}
              className="w-full aspect-video object-cover bg-card/50"
              muted
              loop
              playsInline
              preload="none"
              poster="/background-image-3.avif"
              aria-label="Dreamify way demo video"
              src={MARKETING_MEDIA.fullDemo}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
