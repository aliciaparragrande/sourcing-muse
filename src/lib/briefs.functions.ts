import { createServerFn } from "@tanstack/react-start";
import { requireMrqDomain } from "@/integrations/supabase/mrq-domain-middleware";
import { z } from "zod";

const RoleDetails = z.object({
  title: z.string().default(""),
  level: z.string().default(""),
  team: z.string().default(""),
  location: z.string().default(""),

  must_haves: z.string().default(""),
  nice_to_haves: z.string().default(""),
  context: z.string().default(""),
});

async function attachCandidateCounts<T extends { id: string }>(
  supabase: {
    from: (t: string) => {
      select: (
        s: string,
        o: { count: "exact"; head: true },
      ) => { eq: (col: string, val: string) => Promise<{ count: number | null }> };
    };
  },
  rows: T[],
): Promise<(T & { candidate_count: number })[]> {
  const counts = await Promise.all(
    rows.map(async (r) => {
      const { count } = await supabase
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .eq("brief_id", r.id);
      return count ?? 0;
    }),
  );
  return rows.map((r, i) => ({ ...r, candidate_count: counts[i] }));
}

export const listMyBriefs = createServerFn({ method: "GET" })
  .middleware([requireMrqDomain])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("briefs")
      .select("id, title, status, updated_at, role_details, assigned_to")
      .eq("owner_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = Array.from(
      new Set((data ?? []).map((b) => b.assigned_to).filter((v): v is string => !!v)),
    );
    const { data: profiles } = ids.length
      ? await context.supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", ids)
      : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] };
    const map = new Map((profiles ?? []).map((p) => [p.id, p]));
    const rows = (data ?? []).map((b) => ({
      ...b,
      assignee: b.assigned_to ? map.get(b.assigned_to) ?? null : null,
    }));
    return attachCandidateCounts(context.supabase as never, rows);
  });

export const listAllBriefs = createServerFn({ method: "GET" })
  .middleware([requireMrqDomain])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("briefs")
      .select("id, title, status, updated_at, owner_id, assigned_to, role_details")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const ids = Array.from(
      new Set(
        (data ?? []).flatMap((b) => [b.owner_id, b.assigned_to].filter((v): v is string => !!v)),
      ),
    );
    const { data: profiles } = ids.length
      ? await context.supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", ids)
      : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] };
    const map = new Map((profiles ?? []).map((p) => [p.id, p]));
    const rows = (data ?? []).map((b) => ({
      ...b,
      owner: map.get(b.owner_id) ?? null,
      assignee: b.assigned_to ? map.get(b.assigned_to) ?? null : null,
    }));
    return attachCandidateCounts(context.supabase as never, rows);
  });


export const getBrief = createServerFn({ method: "GET" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: brief, error } = await context.supabase
      .from("briefs")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!brief) throw new Error("Brief not found");
    return brief;
  });

export const createBrief = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { role_details: unknown; title?: string }) =>
    z.object({ role_details: RoleDetails, title: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const title = data.title?.trim() || data.role_details.title?.trim() || "Untitled brief";
    const { data: row, error } = await context.supabase
      .from("briefs")
      .insert({
        owner_id: context.userId,
        title,
        status: "draft",
        role_details: data.role_details,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateBrief = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: {
    id: string;
    title?: string;
    status?: string;
    role_details?: unknown;
    sharpen?: unknown;
    brief?: unknown;
    assigned_to?: string | null;
  }) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().optional(),
        status: z.enum(["draft", "sharpened", "complete", "needs_review"]).optional(),
        role_details: RoleDetails.optional(),
        sharpen: z.record(z.any()).optional(),
        brief: z.record(z.any()).optional(),
        assigned_to: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    // Any authenticated recruiter can edit (RLS enforces authentication).
    const { error } = await context.supabase
      .from("briefs")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(rest as any)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBrief = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("briefs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listRecruiters = createServerFn({ method: "GET" })
  .middleware([requireMrqDomain])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .order("display_name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireMrqDomain])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const email = (context.claims as { email?: string } | null)?.email ?? "";
    return data ? { ...data, email } : null;
  });
