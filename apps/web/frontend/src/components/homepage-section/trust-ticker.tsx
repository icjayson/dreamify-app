

export const TrustTicker = () => {
    const logos = ["Stripe", "QuickBooks", "Xero", "Excel", "Google Sheets"];

    return (
        <div className="py-12 border-t border-white/10 overflow-hidden relative w-full">
            <div className="text-center mb-8">
                <p className="text-sm font-medium text-white/50 uppercase tracking-widest">
                    Integrates with your financial stack
                </p>
            </div>

            <div className="relative flex w-full flex-col items-center justify-center overflow-hidden">
                {/* We use duplicates to create an infinite scrolling effect */}
                <div className="flex w-[200%] md:w-[150%] animate-marquee flex-row gap-8 lg:gap-16 items-center">
                    {[...logos, ...logos, ...logos].map((logo, index) => (
                        <div
                            key={index}
                            className="flex whitespace-nowrap px-8 py-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm text-white/80 font-semibold md:text-xl text-lg opacity-80"
                        >
                            {logo}
                        </div>
                    ))}
                </div>
            </div>

            {/* Marquee Animation styles */}
            <style>{`
        @keyframes marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-33.33%); }
        }
        .animate-marquee {
          animation: marquee 20s linear infinite;
          width: fit-content;
        }
      `}</style>
        </div>
    );
};
