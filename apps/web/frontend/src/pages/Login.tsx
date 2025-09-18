import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, CheckCircle2, ArrowLeft } from "lucide-react";
import WaveBackground from "../../../src/ui/lightswind/wave-background";

const REDIRECT_AFTER_AUTH = "/workspace";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const validate = () => {
    const nextErrors: { email?: string; password?: string } = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = "Invalid email";
    if (password.length < 6) nextErrors.password = "Password must be at least 6 characters";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    const isValid = email === "test@gmail.com" && password === "123456";
    if (isValid) {
      setLoading(false);
      toast({ title: "Logged in", description: "Welcome back!" });
      navigate(REDIRECT_AFTER_AUTH);
    } else {
      setLoading(false);
      toast({ title: "Invalid credentials", description: "Please check your email or password" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 relative overflow-hidden">
      <WaveBackground backdropBlurAmount="md" className="absolute inset-0 z-0" />
      <div className="absolute inset-0 bg-black/60 z-1"></div>

      {/* Back button */}
      <div className="absolute top-4 left-4 z-20">
        <button onClick={() => navigate("/")} aria-label="Back to homepage" className="button-outline px-3 py-1.5 rounded-xl flex items-center">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </button>
      </div>

      <div className="relative z-10 w-full max-w-5xl">
        {/* Minimal Header */}
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center gap-3">
            <img src="/dreamable-logo.png" alt="Dreamable Logo" className="w-8 h-8 object-contain" />
            <span className="text-xl font-semibold text-foreground">Dreamable</span>
          </div>
        </div>

        {/* Split Card */}
        <div className="glass-panel border border-border/30 rounded-3xl overflow-hidden grid grid-cols-1 md:grid-cols-2">
          {/* Brand panel */}
          <div className="hidden md:flex flex-col justify-center gap-6 p-10 bg-gradient-to-br from-primary/10 via-background to-accent/10">
            <div>
              <h2 className="text-2xl font-bold text-white">Welcome to Dreamable</h2>
              <p className="text-white/70 mt-1">Build beautiful dashboards in minutes.</p>
            </div>
            <ul className="space-y-3 text-white/80">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> AI‑assisted insights</li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Real‑time analytics</li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Secure by design</li>
            </ul>
          </div>

          {/* Form panel */}
          <div className="p-8 md:p-10">
            <h3 className="text-2xl font-semibold text-foreground mb-2">Login</h3>
            <p className="text-muted-foreground mb-6">Welcome back! Please sign in to continue.</p>

            {/* Google button (UI-only) */}
            <Button variant="outline" className="w-full mb-4" disabled>
              <span className="mr-2 inline-flex items-center justify-center w-5 h-5 bg-white text-black rounded-sm font-bold">G</span>
              Continue with Google (coming soon)
            </Button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or continue with email</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="text-sm font-medium leading-none">Email</label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <Mail className="w-4 h-4" />
                  </span>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" placeholder="you@example.com" autoComplete="email" />
                </div>
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
              </div>

              <div>
                <label htmlFor="password" className="text-sm font-medium leading-none">Password</label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <Lock className="w-4 h-4" />
                  </span>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" placeholder="••••••" autoComplete="current-password" />
                </div>
                {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="rounded" />
                  Remember me
                </label>
                <a href="#" className="text-sm text-primary hover:underline">Forgot password?</a>
              </div>

              <Button type="submit" className="w-full button-gradient" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> Signing in...</span>
                ) : (
                  "Login"
                )}
              </Button>
            </form>

            <p className="text-sm text-muted-foreground mt-6 text-center">
              Don’t have an account? <Link to="/signup" className="text-primary hover:underline">Sign up</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;


