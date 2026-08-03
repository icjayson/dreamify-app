import React, { type JSX } from "react";
import { MARKETING_MEDIA } from "@/constants/marketingMedia";

interface VideoBackgroundProps {
  className?: string;
}

function VideoBackground({ className = "" }: VideoBackgroundProps): JSX.Element {

  return (
    <div className={`w-full max-w-screen h-full overflow-hidden ${className}`}>
      {/* Video element */}
      <video
        src={MARKETING_MEDIA.background}
        poster="/background-image-3.avif"
        preload="none"
        muted
        playsInline
        autoPlay
        loop
        className="absolute w-full h-full object-cover"
        style={{
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        }}
      />

      {/* Gradient overlay: top fade */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, rgba(255, 255, 255, 0.8) 0%, transparent 30%, transparent 90%, rgba(255, 255, 255, 0.8) 100%)",
        }}
      />
    </div>
  );
}

export default VideoBackground;
