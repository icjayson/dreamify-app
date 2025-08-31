import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { HeroButton } from "@/components/ui/hero-button";
import { Home, ArrowLeft } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-background"></div>
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-20 left-20 w-32 h-32 rounded-full bg-primary/20 blur-3xl animate-pulse"></div>
        <div className="absolute bottom-20 right-20 w-40 h-40 rounded-full bg-secondary/20 blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <div className="relative z-10 text-center px-6">
        <div className="glass-panel rounded-3xl p-12 max-w-md mx-auto">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-8">
            <span className="text-4xl font-bold text-white">404</span>
          </div>
          
          <h1 className="text-4xl font-bold text-foreground mb-4">Page Not Found</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Oops! The page you're looking for seems to have wandered off into the data void.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <HeroButton variant="primary" className="group" onClick={() => window.location.href = "/"}>
              <Home className="mr-2 w-5 h-5 group-hover:scale-110 transition-transform" />
              Return Home
            </HeroButton>
            <HeroButton variant="secondary" className="group" onClick={() => window.history.back()}>
              <ArrowLeft className="mr-2 w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              Go Back
            </HeroButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
