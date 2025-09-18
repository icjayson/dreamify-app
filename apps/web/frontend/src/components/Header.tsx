import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flame, Bell, LogIn } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

const Header = () => {
  const navigate = useNavigate();
  return (
    <header className="fixed top-0 left-0 right-0 z-50 w-full">
      <div className="flex h-14 items-center justify-between px-6 glass-panel border border-border/30 rounded-2xl max-w-6xl mx-auto mt-4">
        {/* Left side - Logo and brand */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center">
              <img 
                src="/dreamable-logo.png"
                alt="Dreamable Logo" 
                className="w-full h-full object-contain"
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
            className="text-sm font-medium text-white hover:text-primary transition-colors"
          >
            Community
          </a>
          <a
            href="#guide"
            className="text-sm font-medium text-white hover:text-primary transition-colors"
          >
            Guide
          </a>
          <a
            href="#pricing"
            className="text-sm font-medium text-white hover:text-primary transition-colors"
          >
            Pricing
          </a>
        </nav>

        {/* Right side - Flame icon, notifications, and login */}
        <div className="flex items-center gap-2">
          {/* Flame icon */}
          <div className="w-9 h-9 flex items-center justify-center cursor-pointer">
            <Flame className="h-5 w-5 text-white" />
            <span className="sr-only">Flame</span>
          </div>

          {/* Notifications */}
          <div className="w-9 h-9 flex items-center justify-center cursor-pointer">
            <Bell className="h-5 w-5 text-white" />
            <span className="sr-only">Notifications</span>
          </div>

          {/* Login button */}
          <button onClick={() => navigate("/login")} className="button-gradient px-4 py-2 text-white font-medium transition-all duration-200 flex items-center gap-2 rounded-xl">
            Login
            <LogIn className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;