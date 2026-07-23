import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CurrentProfile = {
  id: string;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
};

// Cache across the app so every component sees the same identity without refetching.
let cached: CurrentProfile | null = null;
const listeners = new Set<(p: CurrentProfile | null) => void>();

async function load() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    cached = null;
    listeners.forEach((cb) => cb(null));
    return;
  }
  const { data: p } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", data.user.id)
    .maybeSingle();
  const email = data.user.email ?? "";
  cached = p
    ? { id: p.id, display_name: p.display_name, avatar_url: p.avatar_url, email }
    : {
        id: data.user.id,
        display_name: email || null,
        email,
        avatar_url: null,
      };
  listeners.forEach((cb) => cb(cached));
}

export function useCurrentProfile(): CurrentProfile | null {
  const [profile, setProfile] = useState<CurrentProfile | null>(cached);
  useEffect(() => {
    listeners.add(setProfile);
    if (!cached) void load();
    return () => {
      listeners.delete(setProfile);
    };
  }, []);
  return profile;
}

export function displayNameOf(p: CurrentProfile | null): string {
  if (!p) return "Someone";
  if (p.display_name && p.display_name.trim()) return p.display_name.trim().split(" ")[0];
  if (p.email) return p.email.split("@")[0];
  return "Someone";
}
