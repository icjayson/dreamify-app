import { Mail } from "lucide-react";

// X (Twitter) Icon Component
const XIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export const FooterSection = () => {
  const socialLinks = [
    { icon: XIcon, href: "https://x.com/dreamify_dev", label: "X (Twitter)", external: true },
    { icon: Mail, href: "mailto:dreamify.dev@gmail.com", label: "Contact", external: false }
  ];

  return (
    <footer className="relative py-8 border-t border-white/30 z-10">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent"></div>
      
      <div className="relative z-10 container mx-auto px-20">
        <div className="grid md:grid-cols-6 gap-8 mb-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center mb-2">
              <div className="w-40 h-auto rounded-xl flex items-center justify-center mr-3 p-1">
                <img 
                  src="/logo-horizon.png" 
                  alt="Dreamify Logo" 
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-8 max-w-md">
              Transform raw data into stunning, animated dashboards through natural conversation. 
              The future of data visualization is here.
            </p>
            
            {/* Social Links */}
            <div className="flex space-x-4">
              {socialLinks.map((social, index) => (
                <a 
                  key={index}
                  href={social.href}
                  aria-label={social.label}
                  target={social.external ? "_blank" : undefined}
                  rel={social.external ? "noopener noreferrer" : undefined}
                  className="w-8 h-8 rounded-xl glass-panel flex items-center justify-center hover:bg-primary/10 hover:scale-110 transition-all duration-300 group"
                >
                  <social.icon className="w-4 h-4 text-muted-foreground group-hover:text-accent transition-colors" />
                </a>
              ))}
            </div>
          </div>

          {/* Logo Image */}
          <div className="md:col-span-4 flex items-center justify-center md:justify-end md:self-center">
            <img 
              src="/logo-full-horizon-white.png" 
              alt="Dreamify Logo" 
              className="h-auto max-w-full object-contain lg:pl-40 opacity-30"
            />
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-4 border-t border-border">
          <div className="flex justify-between items-center">
            <div className="text-muted-foreground text-sm">
              © 2025 Dreamify. All rights reserved. Made with ✨ for data storytellers.
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};