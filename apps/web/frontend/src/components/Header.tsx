import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";

const Header = () => {
  const navigate = useNavigate();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    const sentinel = document.getElementById('hero-sentinel');

    // If sentinel exists, prefer IntersectionObserver
    if (sentinel && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        setIsScrolled(!entry.isIntersecting);
      }, { root: null, rootMargin: '0px', threshold: 0 });

      observer.observe(sentinel);

      // Initialize based on current intersection by forcing a check using bounding rect
      const rect = sentinel.getBoundingClientRect();
      setIsScrolled(rect.top <= 0);

      return () => observer.disconnect();
    }

    // Fallback: scroll listener with rAF
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setIsScrolled(window.scrollY > 16);
          ticking = false;
        });
        ticking = true;
      }
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll as EventListener);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-[100]">
      <div className={`${
        isScrolled
          ? "max-w-4xl glass-panel-opaque shadow-header header-scrolled"
          : "max-w-6xl"
      } flex h-14 items-center justify-between px-6 glass-panel border border-border/30 rounded-2xl mx-auto mt-4 header-animated transition-[max-width] transition-colors duration-500`}>
        {/* Left side - Logo and brand */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            {/* Logo */}
            <div className="w-32 h-auto rounded-lg flex items-center justify-center">
              <img 
                src="/logo-horizon.png"
                alt="Dreamify Logo" 
                className="w-full h-full object-contain"
                onClick={() => navigate("/")}
              />
            </div>
          </div>
          <nav className="hidden md:flex items-center space-x-4 ml-8">
            <a
              href="#community"
              className="text-sm font-medium text-white hover:text-accent transition-colors"
            >
              Community
            </a>
            <a
              href="#guide"
              className="text-sm font-medium text-white hover:text-accent transition-colors"
            >
              Guide
            </a>
            <a
              href="#pricing"
              className="text-sm font-medium text-white hover:text-accent transition-colors"
            >
              Pricing
            </a>
          </nav>
        </div>

        {/* Center - Navigation menu */}

        {/* Right side - Flame icon, notifications, waitlist, and login */}
        <div className="flex items-center gap-4">
          {/* Waitlist CTA (always visible) */}
          <button 
            onClick={() => navigate("/waitlist")}
            className="button-gradient px-4 py-2 text-white font-medium transition-all text-sm duration-200 flex items-center gap-2 rounded-xl"
          >
            Join the waitlist
          </button>

          {/* Authentication buttons */}
          <SignedOut>
            <button 
              onClick={() => navigate("/login")}
              className="button-outline px-4 py-2 text-white font-medium transition-all text-sm duration-200 flex items-center gap-2 rounded-xl"
            >
              Login
              <LogIn className="w-4 h-4" />
            </button>
          </SignedOut>
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </div>
    </header>
  );
};

export default Header;