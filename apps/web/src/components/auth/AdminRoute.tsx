import { ReactNode } from "react";
import { useNavigate } from "@/lib/navigation";
import { LogIn, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

/**
 * Guards a route behind the same admin check used across /admin: the user must
 * be signed in (Clerk) AND have `publicMetadata.role === "admin"`. Shows the
 * Sign-In / Access-Denied cards otherwise. Used to wrap /admin and /admin/cms.
 */
export default function AdminRoute({ children }: { children: ReactNode }) {
  const { isSignedIn, isAdmin } = useAdminAuth();
  const navigate = useNavigate();

  if (!isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <LogIn className="h-12 w-12 mx-auto text-muted-foreground" />
            <h2 className="text-xl font-semibold">Sign In Required</h2>
            <p className="text-muted-foreground">Please sign in to access the admin panel.</p>
            <Button onClick={() => navigate("/login")}>Go to Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <ShieldAlert className="h-12 w-12 mx-auto text-destructive" />
            <h2 className="text-xl font-semibold">Access Denied</h2>
            <p className="text-muted-foreground">
              You don't have admin permissions. Contact an administrator if you believe this is an error.
            </p>
            <Button variant="outline" onClick={() => navigate("/")}>Go Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
