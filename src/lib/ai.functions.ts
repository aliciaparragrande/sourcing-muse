import { createServerFn } from "@tanstack/react-start";
import { requireMrqDomain } from "@/integrations/supabase/mrq-domain-middleware";
import { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

export const DIMENSION_KEYS = [
  "experience",
  "foundational_company",
  "depth_of_impact",
  "career_agency",
  "domain",
  "global",
  "education",
  "public_footprint",
  "research",
] as const;

export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSIONS: {
  key: DimensionKey;
  name: string;
  description: string;
}[] = [
  {
    key: "experience",
    name: "Experience & maturity",
    description:
      "Years since career start vs. the seniority this role needs. Maturity of judgment, not just years.",
  },
  {
    key: "foundational_company",
    name: "Foundational company exposure",
    description:
      "Started their career somewhere structured (roughly 100+ people). Positive signal, not decisive.",
  },
  {
    key: "depth_of_impact",
    name: "Depth of impact",
    description:
      "At least one role of 3+ years with real, demonstrable contribution. Proof they can go deep.",
  },
  {
    key: "career_agency",
    name: "Career agency",
    description:
      "Active navigation of their own career. Short stints are positive if they signal market awareness — not instability.",
  },
  {
    key: "domain",
    name: "Industry / domain background",
    description: "Real product / sector exposure relevant to this role.",
  },
  {
    key: "global",
    name: "Global / open-mindedness signal",
    description: "Worked or lived abroad. Soft signal, never decisive.",
  },
  {
    key: "education",
    name: "Education",
    description: "University pedigree plus continued learning (masters, courses, certifications).",
  },
  {
    key: "public_footprint",
    name: "Public footprint & communication",
    description:
      "GitHub, blogs, talks, meetups, papers. Weight loosely — absence is NOT a red flag; strong candidates often come by referral.",
  },
  {
    key: "research",
    name: "Research & academic contribution",
    description:
      "Published papers, citation record, PhD/postdoc background, conference/workshop contributions in an academic sense (NeurIPS/ICML/ICLR, arXiv, Google Scholar). Distinct from public footprint: contribution to the field, not general visibility.",
  },
];

const RoleDetailsInput = z.object({
  title: z.string(),
  level: z.string(),
  team: z.string(),
  location: z.string(),
  must_haves: z.string(),
  nice_to_haves: z.string(),
  context: z.string(),
});

const WEIGHTS = ["dealbreaker", "important", "nice_to_have"] as const;

async function callGateway(body: unknown): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from AI");
  return content;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function extractJson(text: string): JsonValue {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  return JSON.parse(raw) as JsonValue;
}

const VOICE =
  "Voice: MrQ Talent — casual, dry, no-nonsense. British English. No corporate fluff, no emojis, no exclamation marks. Say the thing plainly.";

export const sharpenBrief = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { role_details: unknown }) =>
    z.object({ role_details: RoleDetailsInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const dimensionSpec = DIMENSIONS.map(
      (d) => `- ${d.key} — ${d.name}: ${d.description}`,
    ).join("\n");

    const system = `You are a senior tech sourcer at MrQ (online casino / regulated gambling). You help recruiters think through HOW to read candidate CVs for a specific role, across a FIXED 9-dimension framework. You do NOT add, remove, rename, or reorder dimensions.

The 9 dimensions:
${dimensionSpec}

${VOICE}

For each dimension, return:
- default_relevant (boolean): should this dimension be toggled ON by default for THIS role? Use judgment from the role details. Notes:
  * "global" often defaults OFF unless JD implies international scope.
  * "public_footprint" defaults ON for engineering-heavy roles but at low weight; for non-eng roles it's often OFF.
  * "foundational_company" and "education" are usually ON but light.
  * "research" defaults OFF for most roles. Default ON only when the JD signals a research-oriented / PhD-track role (e.g. "applied research", "ML research", "PhD preferred/required", "publish", "novel model architectures"). For standard engineering, design, or ops roles, leave OFF.
- default_weight: one of ${JSON.stringify(WEIGHTS)}. Notes:
  * "public_footprint" defaults to "nice_to_have" — never "dealbreaker".
  * "depth_of_impact" is typically "important" or "dealbreaker" at senior+ levels.
  * "career_agency" is usually "important"; never frame short stints negatively.
  * "research" weight: "important" or "dealbreaker" on research-track roles, "nice_to_have" otherwise.
- suggested_specifics: 2-3 concrete, role-specific specifics for this dimension, grounded DIRECTLY in THIS role's details. Each <=70 chars.

GROUNDING PROTOCOL (do this before writing ANY specifics for ANY dimension):
1. Read the role's Must-haves, Nice-to-haves, and Context fields carefully. Identify the 3-4 most DISTINCTIVE details — things that would NOT appear in a generic JD for this title/level. Examples of distinctive: "small autonomous pods, no dedicated PM", "greenfield rebuild of legacy payments stack", "regulated-market launch into Ontario", "on-call shared with data team". Examples of NOT distinctive: "strong communication", "team player", "senior engineer with experience".
2. Every suggested specific across all 9 dimensions MUST trace back to one of those distinctive details, or to something you can directly quote/paraphrase from role title, level, team, location, must-haves, nice-to-haves, or context. If you cannot point to a source phrase, do not write the specific.
3. REJECT generic filler. A specific that could be pasted unchanged into a brief for a DIFFERENT role in the same general field is wrong. Bad: "Strong technical skills", "Good communicator", "Senior-level experience". Good (only when grounded in stated facts): "Comfortable making product calls without a PM to defer to" (traces to a context field mentioning no dedicated PMs); "Has shipped a regulated-market launch end-to-end" (traces to a stated regulated-market fact).
4. Ask: what does THIS JD say that a generic version of this title wouldn't? Build the specifics from that answer.

SELF-CHECK BEFORE RETURNING: for every specific, silently name the exact phrase or fact in the role details it comes from. If you can't, REPLACE it with one you can, or drop it — 2 grounded specifics beat 3 with one filler. Prefer fewer, sharper specifics over padded lists.

Anchoring examples (valid ONLY if the role details actually support them): payments-domain role → "Fintech/payments product exposure"; stated Staff level → "8+ years, has operated at senior/staff level"; "public_footprint" stays soft → "Any technical writing or talks — bonus, not required"; research-track role that mentions publishing → "First-author publications at top-tier ML venues". Do NOT invent regulated-gambling experience unless the JD clearly needs it.

Return STRICT JSON only. Shape:
{
  "dimensions": [
    { "key": "<one of the 9 keys>", "default_relevant": boolean, "default_weight": "dealbreaker"|"important"|"nice_to_have", "suggested_specifics": string[] }
  ]
}
Return exactly 9 entries, one per key, in the order listed above.`;

    const user = `Role details:\n${JSON.stringify(data.role_details, null, 2)}`;

    const content = await callGateway({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    return extractJson(content);
  });

const DimensionStateSchema = z.object({
  key: z.enum(DIMENSION_KEYS),
  relevant: z.boolean(),
  weight: z.enum(WEIGHTS),
  suggested_specifics: z.array(z.string()).default([]),
  selected_specifics: z.array(z.string()).default([]),
  custom_specifics: z.array(z.string()).default([]),
});

const PROFICIENCIES = ["expert", "working", "exposure"] as const;

const TechItemSchema = z.object({
  name: z.string(),
  category: z.string().default(""),
  proficiency: z.enum(PROFICIENCIES).default("working"),
  weight: z.enum(WEIGHTS).default("important"),
});

export const suggestTechnologies = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { role_details: unknown }) =>
    z.object({ role_details: RoleDetailsInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const system = `You are a senior tech sourcer at MrQ (online casino / regulated gambling). Given a role, list the concrete tools, languages, frameworks, and platforms this person needs to know. This is a technical skill checklist — separate from the CV-reading dimensions the recruiter already set (background, trajectory, character).

${VOICE}

GROUNDING PROTOCOL (do this before writing ANY technology):
1. First pass — EXTRACT: scan title, level, team, must-haves, nice-to-haves, and context. Pull every tool, language, framework, platform, database, cloud, or protocol EXPLICITLY named or unambiguously implied (e.g. "real-time game state" → WebSockets / pub-sub is justified; "handle PII under UKGC" → an actual named compliance/observability tool only if implied). These extracted items are your seed list.
2. Second pass — WEIGHT: everything from must-haves becomes proficiency "expert" and weight "dealbreaker" or "important" (never "nice_to_have"). Nice-to-haves become "working" or "exposure", weight "nice_to_have" or "important". A tool named explicitly in must-haves must appear — do not silently drop it.
3. Third pass — JUSTIFIED ADDITIONS ONLY: you may add a technology beyond the seed list ONLY when a specific phrase in the role details clearly demands it AND the seed list doesn't already cover it. For each addition, you must be able to quote the phrase that justifies it. "It's common for this job title" is NOT a justification. Do not pad with a default stack.
4. REJECT genericization. A backend role does not automatically get PostgreSQL, Redis, Kafka, Docker, Kubernetes, or AWS. A frontend role does not automatically get React, TypeScript, Tailwind, or Next.js. Include any of those ONLY when the role details explicitly name them or describe a problem that specifically requires them.

Bad example: role says "Senior Backend Engineer, Payments" with no other stack detail → suggesting PostgreSQL/Redis/Kafka by default is wrong. Good example: role context says "our ledger runs on Postgres with strict ACID guarantees" → PostgreSQL as "expert"/"dealbreaker" is correct because it's stated.

- For a clearly technical role, aim for 6-12 items — but only if that many are genuinely traceable to the role details. Better to return 4 grounded items than pad to 8 with defaults. For roles that are not primarily technical (design-led, ops, people, comms), an empty or very short list is fine — do not pad.
- Group loosely by category (e.g. "Languages", "Infrastructure / Platform", "Data", "Frontend", "Cloud", "Observability", "Security"). Only assign a category that genuinely fits. Leave category "" if nothing fits.
- proficiency: "expert" (must be strong), "working" (comfortable day-to-day), "exposure" (having seen it is enough).
- weight: "dealbreaker" for must-haves the role can't function without, "important" for solid needs, "nice_to_have" for pluses.

SELF-CHECK BEFORE RETURNING: for every technology in your list, silently name the exact phrase in the role details it traces back to. If you can't, REMOVE it or replace it with a more specific, grounded equivalent. Two very different roles in the same broad category (e.g. two "Senior Engineer" roles — one real-time, one data-pipeline-heavy) should produce visibly different stacks, not the same list reshuffled.

Return STRICT JSON only:
{
  "technologies": [
    { "name": string, "category": string, "proficiency": "expert"|"working"|"exposure", "weight": "dealbreaker"|"important"|"nice_to_have" }
  ]
}`;

    const user = `Role details:\n${JSON.stringify(data.role_details, null, 2)}`;
    const content = await callGateway({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    return extractJson(content);
  });

export const generateSourcingBrief = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { role_details: unknown; sharpen: unknown; tech: unknown }) =>
    z
      .object({
        role_details: RoleDetailsInput,
        sharpen: z.object({
          dimensions: z.array(DimensionStateSchema).default([]),
        }),
        tech: z
          .object({ technologies: z.array(TechItemSchema).default([]) })
          .default({ technologies: [] }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    // Only pass ON dimensions to the model, enriched with their name/description
    const activeDims = data.sharpen.dimensions
      .filter((d) => d.relevant)
      .map((d) => {
        const meta = DIMENSIONS.find((x) => x.key === d.key)!;
        return {
          key: d.key,
          name: meta.name,
          description: meta.description,
          weight: d.weight,
          specifics: Array.from(new Set([...d.selected_specifics, ...d.custom_specifics])),
        };
      });

    const technologies = data.tech.technologies;

    const system = `You are a senior tech sourcer at MrQ (online casino / regulated gambling). Produce a sourcing strategy a recruiter can act on today, driven by the CV-reading dimensions the recruiter has marked relevant AND the specific technology bar they've set.

${VOICE}

Rules:
- Only reason about dimensions passed in (all are "relevant").
- Weight "dealbreaker" dimensions most heavily; "important" solidly; "nice_to_have" lightly.
- For "career_agency": explicitly do NOT frame short tenure as a negative in "red_flags" or elsewhere. Frame active movement / short stints as agency and market-awareness where relevant.
- For "public_footprint": do NOT treat absence of public footprint (no GitHub, no blog, no talks) as a negative signal anywhere in the output. The strongest candidates often come by referral and keep low public profiles. Only surface public-footprint channels as an additional way in, not as a filter.
- For "research" (when relevant): treat as a strong driver of channel choice — prioritise arXiv, Google Scholar, NeurIPS / ICML / ICLR (and adjacent venues like ACL, EMNLP, CVPR) speaker and workshop lists, Hugging Face profiles, and relevant university research group pages.
- Reason about WHERE each relevant dimension shows up online. Then synthesise ONE prioritised channel list across the whole dimension set — do not list channels dimension-by-dimension.
- CHANNEL BIAS: this tool is used to source technical/engineering hires. Bias the channel list toward developer-relevant platforms: GitHub, Stack Overflow, Hacker News (Who's Hiring / Who Wants To Be Hired), Dev.to, Medium engineering tags, Hashnode, technical X/Twitter, Y Combinator "Work at a Startup", Product Hunt makers, arXiv/Scholar for research roles. Include Medium / Dev.to / Hashnode explicitly when the role involves writing, developer advocacy, or when technical writing would be a strong signal. Avoid generic non-technical channels unless the role is clearly non-engineering.
- Technologies USAGE: the technology list refines and sharpens the channels chosen by the dimensions — it does NOT introduce new channels on its own. Use "dealbreaker" and "expert"-level technologies to:
  * Make GitHub / Sourcegraph search strings concrete (specific languages, frameworks, libraries — not generic terms).
  * Sharpen the LinkedIn boolean with the specific tools/frameworks.
  * Populate "signals of excellence" in outreach_angle and channels (e.g. "maintainer of a Go-based observability tool" rather than generic "strong GitHub presence").
  * Shape "keywords" so they are concretely named tools, not vague categories.
- If the technology list is empty, don't invent one — fall back to reasoning from the role details alone.
- Ground everything in the role details plus the active dimensions and their specifics. Do not invent regulated-gambling experience as a filter unless the input clearly asks for it.

Return STRICT JSON only. Shape:
{
  "summary": string (2-3 sentences, plain English, who we're looking for framed by the relevant dimensions),
  "target_companies": {
    "tier_a": [ { "name": string, "hint": string } ] (5-10 — hint = one short phrase telling a junior recruiter where to actually find these people, e.g. "LinkedIn + vercel.com/about", "LinkedIn — Engineering", "GitHub org page"),
    "tier_b": [ { "name": string, "hint": string } ] (5-10),
    "avoid": string[] (with brief reason inline)
  },
  "keywords": string[] (10-15 specific skills/titles/tools — pull directly from the technology list where present),
  "boolean_search_recruiter": string (LinkedIn Recruiter boolean — full nested parentheses, AND/OR/NOT, multiple grouped clauses; wire in dealbreaker/expert tools by name),
  "boolean_search_standard": string (Simplified string for standard linkedin.com people search — quoted phrases, AND/OR/NOT, NO deep nesting, keep only the 2-3 most important terms; flatten aggressively vs the Recruiter version),
  "channels": [ { "name": string, "how": string (1 sentence tying it to which dimension(s) it surfaces, and referencing specific tools where relevant), "query": string (short search query — 2-6 keywords — that we can drop into that platform's search URL; omit or empty string if not applicable), "how_to_search": string[] (2-4 short numbered-style steps, each a plain sentence WITHOUT the leading number — the UI adds numbering. Steps must be concrete to THAT platform's actual UI/mechanics AND grounded in this role's specific keywords/tools/dimensions — not generic advice reusable across channels. E.g. GitHub: "Search '<real keyword from this role>' and filter by Repositories", "Sort by Most stars", "Open contributors on the top 2-3 repos and check their profile activity". Avoid filler like "look for good candidates".) } ] (5-8 channels — ONE combined prioritised list. ALWAYS include a channel named "Google" for Google X-ray CV/resume search — position it by priority alongside the others, with a "how" line about surfacing publicly indexed CVs/resumes on the open web (personal sites, university pages, old PDF uploads) that don't show up via LinkedIn or GitHub, and 3-4 how_to_search steps specific to X-ray search: paste the string into Google and skim the first few result pages, open PDFs directly rather than trusting snippet titles, swap the technology/keyword for a close synonym if results are thin, and treat it as a supplementary cross-check against LinkedIn/GitHub. CONDITIONAL CHANNELS: only include "Dev.to", "Medium", or "Hashnode" when the role has a plausible technical-writing signal — engineering, platform, data, security, devrel, or roles where written thought-leadership matters. RESEARCH PAPERS: when the "research" dimension is present in the relevant dimensions list, include exactly ONE research-papers channel named "arXiv" — do NOT also propose "Google Scholar", "Semantic Scholar", or "dblp" as separate channels; those render as secondary links nested inside the arXiv card. When the "research" dimension is NOT present, omit arXiv entirely. Do not pad with these by default.),
  "github_search_terms": string[] (2-4 short technical search terms suitable for GitHub's repository search — real project keywords like "payments gateway", "risk scoring", the primary language, etc. Used server-side to fetch real repos; do NOT invent repo names yourself),
  "devto_tags": string[] (2-4 short lowercase Dev.to tag slugs matching this role's stack/domain — e.g. "rust", "kubernetes", "fraud", "payments". Used server-side to fetch real articles. Return [] if Dev.to is not among the proposed channels.),
  "arxiv_query": string (a short arXiv search query — 2-6 keywords — grounded in the role's research area, e.g. "recommender systems reinforcement learning". Used server-side to fetch real papers. Return "" if arXiv is not among the proposed channels.),
  "research_is_cs": boolean (true only when the research work is computer-science-specific — ML/AI, systems, security, HCI, PL, distributed systems, etc. False for general physics/bio/pure-math research roles. Controls whether dblp shows as a secondary research link. Return false when the "research" dimension is not relevant.),
  "google_xray": string (ALWAYS include a channel named "Google" in the channels list, positioned by priority same as the others. This field holds the Google X-ray Boolean string for surfacing publicly indexed CVs/resumes on the open web. Use the pattern: ("resume" OR "CV") AND (filetype:pdf OR filetype:doc) AND ("<role-relevant keyword or job title from THIS role>" OR "<specific technology from THIS role>" OR "<another tool>") AND ("<domain or location term relevant to THIS role, if any>"). Ground every keyword/technology/domain term in this specific role's details and technology list — never leave literal placeholders like [technology]. If no meaningful location/domain applies, drop that final AND clause entirely rather than leaving an empty group.),
  "outreach_angle": string (2-3 sentences — the hook, in MrQ voice, that would make this candidate reply),
  "red_flags": string[] (3-5 signals of a poor fit given the relevant dimensions; do NOT include short tenure or absence of public footprint)
}`;


    const user = `Role details:\n${JSON.stringify(data.role_details, null, 2)}\n\nRelevant dimensions:\n${JSON.stringify(activeDims, null, 2)}\n\nTechnology bar (may be empty):\n${JSON.stringify(technologies, null, 2)}`;

    const content = await callGateway({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = extractJson(content) as {
      github_search_terms?: string[];
      devto_tags?: string[];
      arxiv_query?: string;
      channels?: Array<{ name?: string }>;
      [k: string]: JsonValue | undefined;
    };

    // Fetch real GitHub repos server-side. Never let the LLM invent repos.
    let github_repos: {
      name: string;
      full_name: string;
      description: string;
      stars: number;
      url: string;
    }[] = [];
    let github_repos_error: string | null = null;

    try {
      const terms = Array.isArray(parsed.github_search_terms)
        ? parsed.github_search_terms.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        : [];
      // Pull dealbreaker/expert tech names as an additional signal
      const strongTech = technologies
        .filter((t) => t.weight === "dealbreaker" || t.proficiency === "expert")
        .map((t) => t.name)
        .slice(0, 3);
      const primary = terms[0] ?? strongTech[0];
      if (primary) {
        // Build a GitHub search query: primary term + optional language filter from strongTech
        const langCandidates = ["Go", "Rust", "Python", "TypeScript", "JavaScript", "Java", "Kotlin", "Swift", "C++", "C#", "Ruby", "Elixir", "Scala"];
        const lang = strongTech.find((t) => langCandidates.some((l) => l.toLowerCase() === t.toLowerCase()));
        const qParts = [primary];
        if (terms[1]) qParts.push(terms[1]);
        if (lang) qParts.push(`language:${lang}`);
        qParts.push("stars:>50");
        const q = qParts.join(" ");
        const res = await fetch(
          `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=5`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "mrq-sourcing-brief-builder",
            },
          },
        );
        if (res.ok) {
          const body = (await res.json()) as {
            items?: Array<{
              name: string;
              full_name: string;
              description: string | null;
              stargazers_count: number;
              html_url: string;
            }>;
          };
          github_repos = (body.items ?? []).slice(0, 5).map((r) => ({
            name: r.name,
            full_name: r.full_name,
            description: r.description ?? "",
            stars: r.stargazers_count,
            url: r.html_url,
          }));
        } else {
          github_repos_error = `GitHub search failed (${res.status})`;
        }
      }
    } catch (e) {
      github_repos_error = e instanceof Error ? e.message : "GitHub search failed";
    }

    // Fetch Dev.to articles server-side when a Dev.to channel is proposed.
    type DevtoArticle = { title: string; url: string; author: string; tags: string[] };
    let devto_articles: DevtoArticle[] = [];
    let devto_articles_error: string | null = null;
    const hasDevtoChannel = (parsed.channels ?? []).some(
      (c) => typeof c?.name === "string" && /dev\.to|^dev$/i.test(c.name),
    );
    if (hasDevtoChannel) {
      try {
        const tags = Array.isArray(parsed.devto_tags)
          ? parsed.devto_tags
              .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
              .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9]/g, ""))
              .filter((t) => t.length > 0)
              .slice(0, 4)
          : [];
        const seen = new Set<string>();
        for (const tag of tags) {
          if (devto_articles.length >= 5) break;
          const res = await fetch(
            `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=5&top=30`,
            { headers: { Accept: "application/json", "User-Agent": "mrq-sourcing-brief-builder" } },
          );
          if (!res.ok) {
            devto_articles_error = `Dev.to search failed (${res.status})`;
            continue;
          }
          const body = (await res.json()) as Array<{
            title: string;
            url: string;
            user?: { name?: string; username?: string };
            tag_list?: string[];
          }>;
          for (const a of body) {
            if (devto_articles.length >= 5 || seen.has(a.url)) continue;
            seen.add(a.url);
            devto_articles.push({
              title: a.title,
              url: a.url,
              author: a.user?.name || a.user?.username || "",
              tags: (a.tag_list ?? []).filter((t) => tags.includes(t)),
            });
          }
        }
        if (devto_articles.length > 0) devto_articles_error = null;
      } catch (e) {
        devto_articles_error = e instanceof Error ? e.message : "Dev.to search failed";
      }
    }

    // Fetch arXiv papers server-side when an arXiv channel is proposed.
    type ArxivPaper = { title: string; url: string; authors: string[]; published: string };
    let arxiv_papers: ArxivPaper[] = [];
    let arxiv_papers_error: string | null = null;
    const hasArxivChannel = (parsed.channels ?? []).some(
      (c) => typeof c?.name === "string" && /arxiv/i.test(c.name),
    );
    if (hasArxivChannel) {
      try {
        const q = (parsed.arxiv_query || "").trim();
        if (q) {
          const res = await fetch(
            `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(
              `all:${q}`,
            )}&start=0&max_results=5&sortBy=submittedDate&sortOrder=descending`,
            { headers: { "User-Agent": "mrq-sourcing-brief-builder" } },
          );
          if (res.ok) {
            const xml = await res.text();
            const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
            for (const entry of entries.slice(0, 5)) {
              const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim().replace(/\s+/g, " ") ?? "";
              const url = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? "";
              const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.slice(0, 10) ?? "";
              const authors = Array.from(entry.matchAll(/<name>([\s\S]*?)<\/name>/g))
                .map((m) => m[1].trim())
                .filter(Boolean);
              if (title && url) arxiv_papers.push({ title, url, authors, published });
            }
          } else {
            arxiv_papers_error = `arXiv search failed (${res.status})`;
          }
        }
      } catch (e) {
        arxiv_papers_error = e instanceof Error ? e.message : "arXiv search failed";
      }
    }

    return {
      ...parsed,
      github_repos,
      github_repos_error,
      devto_articles,
      devto_articles_error,
      arxiv_papers,
      arxiv_papers_error,
    };
  });

export const findMoreCompanies = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator(
    (d: {
      role_details: unknown;
      sharpen: unknown;
      tech: unknown;
      tier: unknown;
      existing: unknown;
      avoid: unknown;
    }) =>
      z
        .object({
          role_details: RoleDetailsInput,
          sharpen: z.object({
            dimensions: z.array(DimensionStateSchema).default([]),
          }),
          tech: z
            .object({ technologies: z.array(TechItemSchema).default([]) })
            .default({ technologies: [] }),
          tier: z.enum(["tier_a", "tier_b"]),
          existing: z.array(z.string()).default([]),
          avoid: z.array(z.string()).default([]),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const activeDims = data.sharpen.dimensions
      .filter((d) => d.relevant)
      .map((d) => {
        const meta = DIMENSIONS.find((x) => x.key === d.key)!;
        return {
          key: d.key,
          name: meta.name,
          description: meta.description,
          weight: d.weight,
          specifics: Array.from(new Set([...d.selected_specifics, ...d.custom_specifics])),
        };
      });

    const tierLabel = data.tier === "tier_a" ? "Tier A (top priority — direct competitors, closest talent pools)" : "Tier B (adjacent — related sectors, slightly further from the bullseye)";

    const system = `You are a senior tech sourcer at MrQ (online casino / regulated gambling). Your job right now: extend the ${tierLabel} list of target companies for this role with 4-6 ADDITIONAL, meaningfully different companies.

${VOICE}

Rules:
- Apply the SAME reasoning/criteria you'd use in the main sourcing brief — reason from the relevant dimensions and the technology bar.
- STRICT EXCLUSION: do NOT return any company already listed under "Already suggested" or "Avoid". No duplicates, no near-duplicates (e.g. same company different spelling, same parent org).
- Keep the tier meaning consistent: Tier A = direct competitors / closest talent pools; Tier B = adjacent sectors / related pools.
- Quality over quantity. If the realistic pool for THIS specific profile is largely exhausted, return FEWER companies (or zero) and set "exhausted": true with a short "note" explaining why (e.g. "very niche regulated gambling infra pool — most obvious names already listed"). Do NOT pad with weak, generic, or loosely-relevant names just to fill the count.
- Each company gets a short "hint" — one phrase telling a junior recruiter where to actually find these people (e.g. "LinkedIn — Engineering", "GitHub org page", "LinkedIn + company /about").
- Ground names in the role details, active dimensions, and technology bar. No invented companies.

Return STRICT JSON only. Shape:
{
  "companies": [ { "name": string, "hint": string } ],
  "exhausted": boolean,
  "note": string (empty string when not exhausted; otherwise 1 short sentence)
}`;

    const user = `Role details:\n${JSON.stringify(data.role_details, null, 2)}\n\nRelevant dimensions:\n${JSON.stringify(activeDims, null, 2)}\n\nTechnology bar (may be empty):\n${JSON.stringify(data.tech.technologies, null, 2)}\n\nTier to extend: ${data.tier}\n\nAlready suggested in this tier (DO NOT repeat):\n${JSON.stringify(data.existing, null, 2)}\n\nAvoid list (DO NOT repeat):\n${JSON.stringify(data.avoid, null, 2)}`;

    const content = await callGateway({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = extractJson(content) as {
      companies?: Array<{ name?: unknown; hint?: unknown }>;
      exhausted?: unknown;
      note?: unknown;
    };

    const existingLower = new Set(
      [...data.existing, ...data.avoid].map((n) => n.trim().toLowerCase()).filter(Boolean),
    );
    const companies = (parsed.companies ?? [])
      .map((c) => ({
        name: typeof c.name === "string" ? c.name.trim() : "",
        hint: typeof c.hint === "string" ? c.hint.trim() : "",
      }))
      .filter((c) => c.name && !existingLower.has(c.name.toLowerCase()));

    // De-dup within the new batch
    const seen = new Set<string>();
    const deduped = companies.filter((c) => {
      const k = c.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return {
      companies: deduped,
      exhausted: Boolean(parsed.exhausted) || deduped.length === 0,
      note: typeof parsed.note === "string" ? parsed.note : "",
    };
  });



