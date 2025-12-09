import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { waitlistService, WaitlistStatusResponse } from "@/services/waitlistService";
import { CheckCircle2, Clock, XCircle, AlertCircle, Mail } from "lucide-react";

export default function WaitlistStatusCheck() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusData, setStatusData] = useState<WaitlistStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheckStatus = async () => {
    if (!email.trim()) {
      setError("Please enter an email address");
      return;
    }

    setLoading(true);
    setError(null);
    setStatusData(null);

    try {
      const result = await waitlistService.checkStatus(email.trim());
      setStatusData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check status");
    } finally {
      setLoading(false);
    }
  };

  const getStatusVariant = (status: string): "default" | "destructive" => {
    if (status === "revoked" || status === "rejected") {
      return "destructive";
    }
    return "default";
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "accepted":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "pending_invitation":
        return <Mail className="h-5 w-5 text-blue-500" />;
      case "pending_waitlist":
        return <Clock className="h-5 w-5 text-blue-500" />;
      case "revoked":
      case "rejected":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "not_found":
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
      default:
        return <AlertCircle className="h-5 w-5" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "accepted":
        return "border-green-500/50 bg-green-500/10";
      case "pending_invitation":
      case "pending_waitlist":
        return "border-blue-500/50 bg-blue-500/10";
      case "revoked":
      case "rejected":
        return "border-red-500/50 bg-red-500/10";
      case "not_found":
        return "border-gray-500/50 bg-gray-500/10";
      default:
        return "";
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground">Check Your Status</h3>
        <p className="text-sm text-muted-foreground">
          Enter your email to check your waitlist or invitation status
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) {
              handleCheckStatus();
            }
          }}
          className="flex-1 bg-input border-border text-foreground"
          disabled={loading}
        />
        <Button
          onClick={handleCheckStatus}
          disabled={loading || !email.trim()}
          className="button-gradient"
        >
          {loading ? "Checking..." : "Check"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {statusData && (
        <Alert
          variant={getStatusVariant(statusData.status)}
          className={getStatusColor(statusData.status)}
        >
          {getStatusIcon(statusData.status)}
          <AlertTitle className="text-foreground">{statusData.message}</AlertTitle>
          {statusData.action_required && (
            <AlertDescription className="text-sm text-muted-foreground mt-1">
              {statusData.action_required}
            </AlertDescription>
          )}
          {statusData.can_login && (
            <div className="mt-3">
              <Button
                onClick={() => (window.location.href = "/login")}
                className="button-gradient text-sm"
                size="sm"
              >
                Go to Login
              </Button>
            </div>
          )}
        </Alert>
      )}
    </div>
  );
}

