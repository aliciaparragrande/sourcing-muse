import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Profile = { display_name: string | null; email: string; avatar_url: string | null };

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", data.user.id)
        .maybeSingle();
      setProfile(
        p
          ? { display_name: p.display_name, email: data.user.email ?? "", avatar_url: p.avatar_url }
          : {
              display_name: data.user.email ?? null,
              email: data.user.email ?? "",
              avatar_url: null,
            },
      );
    });
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="leading-tight">
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground">Talent Tools</p>
              <p className="text-sm font-semibold text-foreground">Sourcing Brief Builder</p>
            </div>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/"
              className="px-3 py-1.5 rounded-md text-foreground hover:bg-secondary [&.active]:bg-secondary [&.active]:font-medium"
              activeOptions={{ exact: true }}
            >
              My briefs
            </Link>
            <Link
              to="/briefs"
              className="px-3 py-1.5 rounded-md text-foreground hover:bg-secondary [&.active]:bg-secondary [&.active]:font-medium"
            >
              All briefs
            </Link>
            <Link
              to="/new"
              className="ml-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 font-medium"
            >
              New brief
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            {profile?.avatar_url && (
              <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full" />
            )}
            <div className="text-right leading-tight">
              <p className="text-sm font-medium text-foreground">{profile?.display_name}</p>
              <p className="text-xs text-muted-foreground">{profile?.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
