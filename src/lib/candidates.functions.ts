import { createServerFn } from "@tanstack/react-start";
import { requireMrqDomain } from "@/integrations/supabase/mrq-domain-middleware";
import { safeFetch, assertSafeUrl } from "@/lib/safe-fetch";
import { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const STATUSES = [
  "not_contacted",
  "contacted",
  "responded_interested",
  "responded_not_interested",
  "no_response",
] as const;

const EVIDENCE_TYPES = [
  "github_repo",
  "blog_post",
  "research_paper",
  "talk",
  "personal_project",
  "other",
] as const;
type EvidenceType = (typeof EVIDENCE_TYPES)[number];

const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = {
  github_repo: "GitHub repo/contribution",
  blog_post: "Blog post",
  research_paper: "Research paper",
  talk: "Talk/conference",
  personal_project: "Personal project",
  other: "Other",
};

const FETCH_STATUSES = ["ok", "failed", "empty"] as const;

const EvidenceItem = z.object({
  type: z.enum(EVIDENCE_TYPES),
  url: z.string().url(),
  label: z.string().max(500).optional().default(""),
  fetch_status: z.enum(FETCH_STATUSES).optional(),
  fetched_title: z.string().optional().default(""),
  fetched_excerpt: z.string().optional().default(""),
});
type EvidenceItemT = z.infer<typeof EvidenceItem>;

const OtherLinks = z.array(z.string().url()).default([]);

const CandidateInput = z.object({
  id: z.string().uuid().optional(),
  brief_id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  linkedin_url: z.string().url().nullable().optional(),
  github_url: z.string().url().nullable().optional(),
  other_links: OtherLinks,
  evidence: z.array(EvidenceItem).default([]),
  current_company_role: z.string().nullable().optional(),
  recruiter_notes: z.string().default(""),
  status: z.enum(STATUSES).default("not_contacted"),
});

export const listCandidates = createServerFn({ method: "GET" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { brief_id: string }) =>
    z.object({ brief_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("candidates")
      .select("*")
      .eq("brief_id", data.brief_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- URL fetch + extract ----------

async function fetchUrlRaw(url: string): Promise<string | null> {
  try {
    assertSafeUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const res = await safeFetch(url, {
      headers: {
        "User-Agent": "mrq-sourcing-brief-builder",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain|application\/json/i.test(ctype)) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return og[1].trim();
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t?.[1]?.trim() ?? "";
}

function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (!/github\.com$/.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

async function fetchGithubRepo(
  url: string,
): Promise<{ title: string; excerpt: string } | null> {
  const info = parseGithubRepo(url);
  if (!info) return null;
  try {
    const api = `https://api.github.com/repos/${info.owner}/${info.repo}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(api, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "mrq-sourcing" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = (await res.json()) as {
      full_name?: string;
      description?: string | null;
      language?: string | null;
      stargazers_count?: number;
      topics?: string[];
    };
    const title = j.full_name ?? `${info.owner}/${info.repo}`;
    const bits: string[] = [];
    if (j.description) bits.push(j.description);
    if (j.language) bits.push(`Primary language: ${j.language}.`);
    if (Array.isArray(j.topics) && j.topics.length) bits.push(`Topics: ${j.topics.join(", ")}.`);
    if (typeof j.stargazers_count === "number") bits.push(`${j.stargazers_count} stars.`);

    // README (best effort)
    try {
      const readmeRes = await fetch(`${api}/readme`, {
        headers: { Accept: "application/vnd.github.raw", "User-Agent": "mrq-sourcing" },
      });
      if (readmeRes.ok) {
        const readme = await readmeRes.text();
        const cleaned = readme
          .replace(/```[\s\S]*?```/g, " ")
          .replace(/[#>*_`\-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (cleaned) bits.push(`README excerpt: ${cleaned.slice(0, 1200)}`);
      }
    } catch {
      /* ignore */
    }

    const excerpt = bits.join(" ").slice(0, 2000);
    if (!excerpt) return null;
    return { title, excerpt };
  } catch {
    return null;
  }
}

async function fetchArxiv(url: string): Promise<{ title: string; excerpt: string } | null> {
  try {
    const m = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9.]+)/i);
    if (!m) return null;
    const id = m[1].replace(/\.pdf$/, "");
    const res = await fetch(`http://export.arxiv.org/api/query?id_list=${id}`);
    if (!res.ok) return null;
    const xml = await res.text();
    const title = xml.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
    const summary = xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() ?? "";
    if (!title && !summary) return null;
    return { title: title.replace(/\s+/g, " "), excerpt: summary.replace(/\s+/g, " ").slice(0, 2000) };
  } catch {
    return null;
  }
}

async function enrichEvidence(item: EvidenceItemT): Promise<EvidenceItemT> {
  // Preserve any already-verified content the client sends back on edit.
  if (item.fetch_status && item.fetch_status !== "failed" && item.fetched_excerpt) {
    return item;
  }

  // Type-specific first.
  if (item.type === "github_repo") {
    const gh = await fetchGithubRepo(item.url);
    if (gh) {
      return { ...item, fetch_status: "ok", fetched_title: gh.title, fetched_excerpt: gh.excerpt };
    }
  }
  if (item.type === "research_paper" && /arxiv\.org/i.test(item.url)) {
    const ax = await fetchArxiv(item.url);
    if (ax) {
      return { ...item, fetch_status: "ok", fetched_title: ax.title, fetched_excerpt: ax.excerpt };
    }
  }

  // Generic HTML.
  const html = await fetchUrlRaw(item.url);
  if (!html) return { ...item, fetch_status: "failed", fetched_title: "", fetched_excerpt: "" };
  const title = extractTitle(html);
  const text = stripHtmlToText(html).slice(0, 2000);
  if (text.length < 40 && !title) {
    return { ...item, fetch_status: "empty", fetched_title: "", fetched_excerpt: "" };
  }
  return { ...item, fetch_status: "ok", fetched_title: title, fetched_excerpt: text };
}

export const upsertCandidate = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: unknown) =>
    CandidateInput.extend({ added_by_name: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Enrich any evidence items that don't yet have fetched content.
    const enriched = await Promise.all(data.evidence.map(enrichEvidence));

    const payload = {
      brief_id: data.brief_id,
      name: data.name.trim(),
      email: data.email?.trim() || null,
      linkedin_url: data.linkedin_url?.trim() || null,
      github_url: data.github_url?.trim() || null,
      other_links: data.other_links,
      evidence: enriched,
      current_company_role: data.current_company_role?.trim() || null,
      recruiter_notes: data.recruiter_notes,
      status: data.status,
    };
    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("candidates")
        .update(payload)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await context.supabase
      .from("candidates")
      .insert({
        ...payload,
        added_by: context.userId,
        added_by_name: data.added_by_name ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateCandidateStatus = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { id: string; status: string }) =>
    z.object({ id: z.string().uuid(), status: z.enum(STATUSES) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("candidates")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateCandidateOutreach = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { id: string; outreach_message: string }) =>
    z.object({ id: z.string().uuid(), outreach_message: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("candidates")
      .update({ outreach_message: data.outreach_message })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCandidate = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("candidates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Outreach generation ----------

export const generateOutreach = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { candidate_id: string; brief_id: string }) =>
    z.object({ candidate_id: z.string().uuid(), brief_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const [{ data: cand, error: cErr }, { data: brief, error: bErr }] = await Promise.all([
      context.supabase.from("candidates").select("*").eq("id", data.candidate_id).maybeSingle(),
      context.supabase
        .from("briefs")
        .select("title, role_details, brief")
        .eq("id", data.brief_id)
        .maybeSingle(),
    ]);
    if (cErr) throw new Error(cErr.message);
    if (bErr) throw new Error(bErr.message);
    if (!cand) throw new Error("Candidate not found");
    if (!brief) throw new Error("Brief not found");

    const rawEvidence = Array.isArray(cand.evidence) ? (cand.evidence as EvidenceItemT[]) : [];
    // Ensure each evidence item is fetched (in case it was saved before the
    // fetch feature landed). This is a no-op for items already enriched.
    const evidence = await Promise.all(
      rawEvidence.map((e) =>
        e && typeof e === "object" && "url" in e
          ? enrichEvidence({
              type: (e.type as EvidenceType) ?? "other",
              url: String(e.url),
              label: typeof e.label === "string" ? e.label : "",
              fetch_status: e.fetch_status,
              fetched_title: e.fetched_title ?? "",
              fetched_excerpt: e.fetched_excerpt ?? "",
            })
          : Promise.resolve(null as unknown as EvidenceItemT),
      ),
    );
    const cleanEvidence = evidence.filter((e): e is EvidenceItemT => !!e);

    const roleDetails = brief.role_details as Record<string, unknown> | null;
    const briefData = brief.brief as Record<string, unknown> | null;
    const outreachAngle =
      typeof briefData?.outreach_angle === "string" ? briefData.outreach_angle : "";

    const evidenceForPrompt = cleanEvidence.map((e) => ({
      type: EVIDENCE_TYPE_LABEL[e.type],
      url: e.url,
      recruiter_label: e.label ?? "",
      fetched_title: e.fetched_title ?? "",
      fetched_excerpt: e.fetched_excerpt ?? "",
      verified: e.fetch_status === "ok",
      fetch_status: e.fetch_status ?? "failed",
    }));

    const system = `You are drafting a short, personalized recruiting outreach message for MrQ (online casino / regulated gambling) to a specific candidate.

Voice: casual, dry, no-nonsense, British English. No corporate fluff, no emojis, no exclamation marks. Sound like a human, not a template. 4-7 sentences max.

CRITICAL — NO FABRICATION:
- You may ONLY reference specific facts that appear in: (a) the recruiter's typed notes, or (b) a VERIFIED evidence item (verified=true) — using its fetched_title / fetched_excerpt.
- For UNVERIFIED evidence items (verified=false, fetch_status "failed" or "empty"): you may reference them ONLY as loosely as the recruiter's own short "recruiter_label" allows, and never invent specifics (no made-up paper titles, project names, article arguments). If the recruiter's label says nothing concrete, omit the item entirely.
- The LinkedIn URL and general GitHub profile URL tell you WHO they are but NOT what they've done. Do not extrapolate.
- If uncertain about a specific detail, leave it out.

Type-specific rules for VERIFIED evidence:
- "GitHub repo/contribution" → name the repo (fetched_title) and what it actually does per the fetched description/README. Never just "I saw your GitHub".
- "Blog post" → reference the actual post title and its real topic/argument from the fetched excerpt. Never just "I read your blog".
- "Research paper" → reference the actual paper title and its topic from the fetched abstract.
- "Talk/conference", "Personal project", "Other" → be as specific as the fetched content allows.

Structure:
1. Short, human opener referencing ONE grounded thing — a verified evidence item, or (failing that) the recruiter's own reason from their notes.
2. One or two lines about the role and why THIS person might care (draw on the outreach angle).
3. A soft CTA — chat / grab 20 min / no pressure. No hard sell.

Return STRICT JSON only:
{ "message": string, "sources_used": string[] }
"sources_used" lists the URLs of evidence items you actually referenced (empty array if none).`;

    const userPayload = {
      role: {
        title: (roleDetails?.title as string) ?? brief.title,
        level: (roleDetails?.level as string) ?? "",
        team: (roleDetails?.team as string) ?? "",
        context: (roleDetails?.context as string) ?? "",
      },
      outreach_angle: outreachAngle,
      candidate: {
        name: cand.name,
        current_company_role: cand.current_company_role ?? "",
        recruiter_notes: cand.recruiter_notes ?? "",
        linkedin_url: cand.linkedin_url ?? "",
        github_profile_url: cand.github_url ?? "",
      },
      evidence: evidenceForPrompt,
    };

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(userPayload, null, 2) },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (res.status === 429) throw new Error("Rate limit hit — try again in a moment.");
    if (res.status === 402)
      throw new Error("AI credits exhausted. Add credits in workspace settings.");
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI gateway ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = (() => {
      try {
        const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        return JSON.parse((fence ? fence[1] : content).trim()) as {
          message?: string;
          sources_used?: string[];
        };
      } catch {
        return { message: content, sources_used: [] };
      }
    })();
    const message = parsed.message ?? "";
    const sources_used = Array.isArray(parsed.sources_used) ? parsed.sources_used : [];

    // Persist enriched evidence + draft.
    await context.supabase
      .from("candidates")
      .update({
        outreach_message: message,
        outreach_sources: sources_used,
        evidence: cleanEvidence,
      })
      .eq("id", data.candidate_id);

    const verified_urls = cleanEvidence.filter((e) => e.fetch_status === "ok").map((e) => e.url);
    const unverified_urls = cleanEvidence
      .filter((e) => e.fetch_status !== "ok")
      .map((e) => e.url);

    return {
      message,
      sources_used,
      verified_urls,
      unverified_urls,
    };
  });
