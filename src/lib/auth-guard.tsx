// src/lib/auth-guard.tsx
// Strict role-based route guard for EquaTranslate PRO
// Validates session and profile directly from Supabase, preventing cross-role portal access.

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { clearSession, saveSession, type Role, type Session } from "@/lib/session";
import { SpaceBackground } from "@/components/SpaceBackground";
import { Loader2 } from "lucide-react";

export function AuthGuard({ requiredRole, children }: { requiredRole: Role; children: ReactNode }) {
  const navigate = useNavigate();
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    async function verifyAccess() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          clearSession();
          if (isMounted) {
            setIsAuthorized(false);
            setChecking(false);
            navigate({ to: "/", replace: true });
          }
          return;
        }

        // Verify actual profile and role directly from Supabase database
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle();

        if (error || !profile) {
          clearSession();
          if (isMounted) {
            setIsAuthorized(false);
            setChecking(false);
            navigate({ to: "/", replace: true });
          }
          return;
        }

        const actualRole = profile.role as Role;

        // Role mismatch: redirect to the user's actual portal
        if (actualRole !== requiredRole) {
          if (isMounted) {
            setIsAuthorized(false);
            setChecking(false);
            if (actualRole === "student") {
              navigate({ to: "/student", replace: true });
            } else if (actualRole === "teacher") {
              navigate({ to: "/teacher", replace: true });
            } else {
              navigate({ to: "/", replace: true });
            }
          }
          return;
        }

        // Authorized: sync verified session context
        if (isMounted) {
          const userMeta = session.user.user_metadata as Record<string, unknown> | undefined;
          const currentSession: Session = {
            userId: session.user.id,
            role: actualRole,
            name: profile.name,
            email: session.user.email ?? undefined,
            rollId: (userMeta?.["rollId"] as string) || "ET-4821",
            language: profile.language || "English",
            department: (userMeta?.["department"] as string) || "Physics",
          };
          saveSession(currentSession);
          setIsAuthorized(true);
          setChecking(false);
        }
      } catch (err) {
        console.error("[AuthGuard] Verification error:", err);
        if (isMounted) {
          setIsAuthorized(false);
          setChecking(false);
          navigate({ to: "/", replace: true });
        }
      }
    }

    verifyAccess();

    // Listen to real-time auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, authSession) => {
      if (event === "SIGNED_OUT" || !authSession) {
        clearSession();
        if (isMounted) {
          setIsAuthorized(false);
          navigate({ to: "/", replace: true });
        }
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, requiredRole]);

  if (checking || !isAuthorized) {
    return (
      <div className="relative flex min-h-screen items-center justify-center">
        <SpaceBackground />
        <div className="glass flex items-center gap-3 rounded-2xl px-6 py-4 text-xs text-muted-foreground shadow-2xl">
          <Loader2 className="size-4 animate-spin text-cyan" />
          <span>Verifying portal authorization...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
