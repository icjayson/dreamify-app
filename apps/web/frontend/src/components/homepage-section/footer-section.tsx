import { Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { useTheme } from "@/hooks/useTheme";

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

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1569 2.419zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1568 2.419z" />
  </svg>
);

const FacebookIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

export const FooterSection = () => {
  const { resolvedTheme } = useTheme();
  const logoHorizon = resolvedTheme === 'dark' ? "/logo-horizon.png" : "/logo-horizon-dark.png";
  const logoFullHorizon = resolvedTheme === 'dark' ? "/logo-full-horizon-white.png" : "/logo-full-horizon-dark.png";

  const socialLinks = [
    { icon: XIcon, href: "https://x.com/dreamify_dev", label: "X (Twitter)", external: true },
    { icon: FacebookIcon, href: "https://www.facebook.com/profile.php?id=61587411536040", label: "Facebook", external: true },
    { icon: DiscordIcon, href: "https://discord.gg/GhFjdbgdxd", label: "Discord", external: true },
    { icon: Mail, href: "https://mail.google.com/mail/?view=cm&to=dreamify.dev@gmail.com&su=Contact%20Dreamify", label: "Contact", external: true }
  ];

  return (
    <footer className="relative py-8 border-t border-border dark:border-white/10 z-10">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent"></div>

      <div className="relative z-10 container mx-auto px-20">
        <div className="grid md:grid-cols-6 gap-8 mb-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center mb-2">
              <div className="w-40 h-auto rounded-xl flex items-center justify-center mr-3 p-1">
                <img
                  src={logoHorizon}
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
              src={logoFullHorizon}
              alt="Dreamify Logo"
              className="h-auto max-w-full object-contain lg:pl-40 opacity-30"
            />
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-4 border-t border-border">
          <div className="flex gap-4 text-sm text-muted-foreground">
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
            <Link to="/docs" className="hover:text-foreground transition-colors">Documentation</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};