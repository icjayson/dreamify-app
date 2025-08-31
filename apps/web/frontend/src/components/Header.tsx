import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Moon, Sun, Bell, LogIn } from "lucide-react";
import { useState } from "react";

const Header = () => {
  const [isDarkMode, setIsDarkMode] = useState(true);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    // You can add theme toggle logic here
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left side - Logo and brand */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center">
              <img 
                src="/logo.png" 
                alt="Dreamable Logo" 
                className="w-full h-full object-cover"
              />
            </div>
            {/* Brand name */}
            <span className="text-lg font-semibold text-foreground">
              Dreamable
            </span>
          </div>
        </div>

        {/* Center - Navigation menu */}
        <nav className="hidden md:flex items-center space-x-6">
          <a
            href="#community"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Community
          </a>
          <a
            href="#guide"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Guide
          </a>
          <a
            href="#pricing"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Pricing
          </a>
        </nav>

        {/* Right side - Theme toggle, notifications, and login */}
        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="w-9 h-9"
          >
            {isDarkMode ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
            <span className="sr-only">Toggle theme</span>
          </Button>

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="w-9 h-9">
            <Bell className="h-4 w-4" />
            <span className="sr-only">Notifications</span>
          </Button>

          {/* Login button */}
          <Button
            size="sm"
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 0 20px hsl(261 83% 58% / 0.6), 10px 10px 30px -5px hsl(261 83% 58% / 0.4), 0 0 0 1px hsl(261 83% 58% / 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '';
            }}
            className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-medium px-4 transition-all duration-200"
          >
            <LogIn className="w-4 h-4 mr-2" />
            Login
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;