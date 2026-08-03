import React, { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  title: string;
}

interface DocsLayoutProps {
  children: React.ReactNode;
  metadata: {
    title: string;
    effectiveDate: string;
    description: string;
  };
  toc: TocItem[];
}

const DocsLayout: React.FC<DocsLayoutProps> = ({ children, metadata, toc }) => {
  const [activeSection, setActiveSection] = useState<string>("");
  const location = useLocation();
  const isClickScrolling = useRef(false);

  useEffect(() => {
    const handleScroll = () => {
      if (isClickScrolling.current) return;

      const sections = toc.map((item) => document.getElementById(item.id));
      let currentActiveId = "";
      const scrollPosition = window.scrollY + 150;

      for (let i = sections.length - 1; i >= 0; i--) {
        const section = sections[i];
        if (section) {
          const sectionTop = section.getBoundingClientRect().top + window.scrollY;
          if (sectionTop <= scrollPosition) {
            currentActiveId = section.id;
            break;
          }
        }
      }

      // Identify if we've scrolled practically to the absolute bottom
      const isAtBottom = Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 20;
      if (isAtBottom && toc.length > 0) {
        currentActiveId = toc[toc.length - 1].id;
      }

      if (currentActiveId && currentActiveId !== activeSection) {
        setActiveSection(currentActiveId);
      } else if (window.scrollY < 100 && activeSection !== "") {
        // Reset if we scroll to the very top
        setActiveSection(toc[0]?.id || "");
      }
    };

    window.addEventListener("scroll", handleScroll);
    // Initial check
    setTimeout(handleScroll, 100);

    return () => window.removeEventListener("scroll", handleScroll);
  }, [toc, activeSection]);

  // Handle scroll to hash on load
  useEffect(() => {
    if (location.hash) {
      const id = location.hash.substring(1); // remove '#'
      const element = document.getElementById(id);
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: "smooth" });
          setActiveSection(id);
        }, 100);
      }
    }
  }, [location.hash]);

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const element = document.getElementById(id);
    if (element) {
      isClickScrolling.current = true;
      // Adjust scroll position to account for any fixed headers if exist (e.g., - 80px)
      const y = element.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: y, behavior: "smooth" });
      
      // Update URL without a full page reload
      window.history.pushState(null, "", `#${id}`);
      setActiveSection(id);

      // Re-enable scroll listener after smoothly scrolling
      setTimeout(() => {
        isClickScrolling.current = false;
      }, 800);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* Mobile Header Data (Visible only on small screens) */}
      <div className="md:hidden pt-8 px-6 pb-4 border-b border-border">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{metadata.title}</h1>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            Effective Date: {metadata.effectiveDate}
          </p>
          <p className="mt-4 text-muted-foreground text-sm">
            {metadata.description}
          </p>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 md:py-16 lg:pr-12 md:pl-12 lg:pl-16">
        
        {/* Desktop Header Data */}
        <div className="hidden md:block mb-12">
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">{metadata.title}</h1>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Effective Date: {metadata.effectiveDate}
          </p>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-3xl">
            {metadata.description}
          </p>
        </div>

        {/* Content Wrapper */}
        <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-24 space-y-10">
          {children}
        </div>
      </div>

      {/* Right Sidebar - Table of Contents */}
      <div className="hidden lg:block w-72 shrink-0 border-l border-border/50">
        <div className="sticky top-0 py-16 px-8 max-h-screen overflow-y-auto">
          <h4 className="text-sm font-semibold tracking-wider text-foreground mb-4 uppercase">
            On this page
          </h4>
          <nav className="flex flex-col space-y-2">
            {toc.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => scrollToSection(e, item.id)}
                className={cn(
                  "text-sm transition-colors hover:text-foreground py-1",
                  activeSection === item.id 
                    ? "font-medium text-foreground text-primary" 
                    : "text-muted-foreground"
                )}
              >
                {item.title}
              </a>
            ))}
            
            <div className="pt-6 mt-4 border-t border-border/50">
               <Link 
                  to="/" 
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                  Back to Home
                </Link>
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
};

export default DocsLayout;
