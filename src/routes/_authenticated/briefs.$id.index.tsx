import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { RoleDetailsForm, emptyRoleDetails, type RoleDetails } from "@/components/role-details-form";
import { getBrief, updateBrief, listRecruiters } from "@/lib/briefs.functions";
import { sharpenBrief, generateSourcingBrief, suggestTechnologies, findMoreCompanies } from "@/lib/ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useCurrentProfile, displayNameOf, type CurrentProfile } from "@/hooks/use-current-profile";

const searchSchema = z.object({
  step: z.enum(["details", "sharpen", "tech", "brief"]).default("details"),
});

export const Route = createFileRoute("/_authenticated/briefs/$id/")({
  head: () => ({
    meta: [{ title: "Brief — Sourcing Brief Builder" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: searchSchema,
  component: BriefEditor,
});

// The 9 fixed CV-reading dimensions. Order is fixed; only per-dimension
// content is AI-generated.
const DIMENSION_KEYS = [
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
type DimensionKey = (typeof DIMENSION_KEYS)[number];

const DIMENSIONS: { key: DimensionKey; name: string; description: string }[] = [
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
      "At least one role of 3+ years with real, demonstrable contribution.",
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
      "GitHub, blogs, talks, meetups, papers. Absence is NOT a red flag — many strong candidates come by referral.",
  },
  {
    key: "research",
    name: "Research & academic contribution",
    description:
      "Published papers, citation record, PhD/postdoc background, conference/workshop contributions (NeurIPS/ICML/ICLR, arXiv, Google Scholar). Contribution to the field, not general visibility.",
  },
];

type Weight = "dealbreaker" | "important" | "nice_to_have";
const WEIGHT_LABELS: Record<Weight, string> = {
  dealbreaker: "Dealbreaker",
  important: "Important",
  nice_to_have: "Nice-to-have",
};

type DimensionState = {
  key: DimensionKey;
  relevant: boolean;
  weight: Weight;
  suggested_specifics: string[];
  selected_specifics: string[];
  custom_specifics: string[];
};

type Proficiency = "expert" | "working" | "exposure";
const PROFICIENCY_LABELS: Record<Proficiency, string> = {
  expert: "Expert",
  working: "Working knowledge",
  exposure: "Exposure is enough",
};

type TechItem = {
  name: string;
  category: string;
  proficiency: Proficiency;
  weight: Weight;
};

type Tech = {
  technologies?: TechItem[];
};

type StaleFlags = { sharpen?: boolean; tech?: boolean; brief?: boolean };

type Sharpen = {
  dimensions?: DimensionState[];
  technologies?: TechItem[]; // persisted inside the sharpen JSON blob
  stale?: StaleFlags & { _prior?: string };
};

type Company = { name: string; hint?: string };
type SearchLogEntry = {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
  channel_key?: string;
  performed_by?: string;
};

type BriefOut = {
  summary?: string;
  target_companies?: {
    tier_a?: (Company | string)[];
    tier_b?: (Company | string)[];
    avoid?: string[];
  };
  keywords?: string[];
  boolean_search?: string; // legacy — kept for backward compat
  boolean_search_recruiter?: string;
  boolean_search_standard?: string;
  channels?: { name: string; how: string; query?: string; how_to_search?: string[] }[];
  outreach_angle?: string;
  red_flags?: string[];
  search_log?: SearchLogEntry[];
  github_repos?: { name: string; full_name: string; description: string; stars: number; url: string }[];
  github_repos_error?: string | null;
  devto_articles?: { title: string; url: string; author: string; tags: string[] }[];
  devto_articles_error?: string | null;
  arxiv_papers?: { title: string; url: string; authors: string[]; published: string }[];
  arxiv_papers_error?: string | null;
  google_xray?: string;
  research_is_cs?: boolean;
};


type StepKey = "details" | "sharpen" | "tech" | "brief";
type StaleField = "sharpen" | "tech" | "brief";
type PersistedStatus = "draft" | "sharpened" | "complete" | "needs_review";

const STEP_LABELS: Record<StepKey, string> = {
  details: "Role details",
  sharpen: "Read the CV",
  tech: "Tools & Technologies",
  brief: "Sourcing brief",
};

function BriefEditor() {
  const { id } = Route.useParams();
  const { step } = Route.useSearch();
  const navigate = useNavigate();
  const fetchBrief = useServerFn(getBrief);
  const save = useServerFn(updateBrief);

  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<RoleDetails>(emptyRoleDetails());
  const [title, setTitle] = useState("");
  const [sharpen, setSharpen] = useState<Sharpen>({});
  const [brief, setBrief] = useState<BriefOut>({});
  const [status, setStatus] = useState<PersistedStatus>("draft");
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const currentProfile = useCurrentProfile();
  const performedBy = displayNameOf(currentProfile);

  const fetchRecruiters = useServerFn(listRecruiters);
  const [recruiters, setRecruiters] = useState<Awaited<ReturnType<typeof listRecruiters>>>([]);
  useEffect(() => {
    fetchRecruiters().then(setRecruiters).catch(() => setRecruiters([]));
  }, [fetchRecruiters]);

  // Snapshot of last-persisted values used to detect edits per-step.
  const loadedRef = useRef({ details: "", title: "", dims: "", techs: "" });

  const snap = (
    d: RoleDetails,
    t: string,
    s: Sharpen,
  ) => ({
    details: JSON.stringify(d),
    title: t,
    dims: JSON.stringify(s.dimensions ?? []),
    techs: JSON.stringify(s.technologies ?? []),
  });

  useEffect(() => {
    fetchBrief({ data: { id } })
      .then((row) => {
        const nextDetails = { ...emptyRoleDetails(), ...(row.role_details as object) };
        const nextSharpen = (row.sharpen as Sharpen) ?? {};
        setTitle(row.title);
        setStatus((row.status as PersistedStatus) ?? "draft");
        setDetails(nextDetails);
        setSharpen(nextSharpen);
        setBrief((row.brief as BriefOut) ?? {});
        setAssignedTo(row.assigned_to ?? null);
        setOwnerId(row.owner_id ?? null);
        loadedRef.current = snap(nextDetails, row.title, nextSharpen);
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [id, fetchBrief]);

  const currentStep: 1 | 2 | 3 | 4 =
    step === "brief" ? 4 : step === "tech" ? 3 : step === "sharpen" ? 2 : 1;

  const tech: Tech = { technologies: sharpen.technologies ?? [] };
  const setTech = (t: Tech) =>
    setSharpen({ ...sharpen, technologies: t.technologies ?? [] });

  const reached = {
    sharpen: (sharpen.dimensions?.length ?? 0) > 0,
    tech: (sharpen.technologies?.length ?? 0) > 0,
    brief: !!brief.summary,
  };
  const staleFlags: StaleFlags = {
    sharpen: sharpen.stale?.sharpen === true,
    tech: sharpen.stale?.tech === true,
    brief: sharpen.stale?.brief === true,
  };

  async function persist(patch: {
    title?: string;
    status?: PersistedStatus;
    role_details?: RoleDetails;
    sharpen?: Sharpen;
    brief?: BriefOut;
    clearStale?: StaleField[];
  }) {
    const nextDetails = patch.role_details ?? details;
    const nextTitle = patch.title ?? title;
    const incomingSharpen: Sharpen = patch.sharpen ?? sharpen;
    const nextBrief = patch.brief ?? brief;

    const next = snap(nextDetails, nextTitle, incomingSharpen);
    const prev = loadedRef.current;

    const priorStale = incomingSharpen.stale ?? {};
    const flags: StaleFlags = {
      sharpen: priorStale.sharpen === true,
      tech: priorStale.tech === true,
      brief: priorStale.brief === true,
    };

    const reachedNext = {
      sharpen: (incomingSharpen.dimensions?.length ?? 0) > 0,
      tech: (incomingSharpen.technologies?.length ?? 0) > 0,
      brief: !!nextBrief.summary,
    };

    const detailsChanged = prev.details !== next.details || prev.title !== next.title;
    const dimsChanged = prev.dims !== next.dims;
    const techsChanged = prev.techs !== next.techs;

    if (detailsChanged) {
      if (reachedNext.sharpen) flags.sharpen = true;
      if (reachedNext.tech) flags.tech = true;
      if (reachedNext.brief) flags.brief = true;
    }
    if (dimsChanged) {
      if (reachedNext.tech) flags.tech = true;
      if (reachedNext.brief) flags.brief = true;
    }
    if (techsChanged) {
      if (reachedNext.brief) flags.brief = true;
    }
    for (const k of patch.clearStale ?? []) flags[k] = false;

    const anyStale = !!(flags.sharpen || flags.tech || flags.brief);
    const priorForRestore = priorStale._prior ?? (status === "needs_review" ? undefined : status);

    let nextStatus: PersistedStatus = patch.status ?? status;
    if (anyStale) {
      nextStatus = "needs_review";
    } else if (status === "needs_review" && !patch.status) {
      nextStatus =
        (priorForRestore as PersistedStatus | undefined) ??
        (reachedNext.brief ? "sharpened" : reachedNext.sharpen ? "sharpened" : "draft");
    }

    const nextSharpen: Sharpen = {
      ...incomingSharpen,
      stale: {
        sharpen: flags.sharpen || undefined,
        tech: flags.tech || undefined,
        brief: flags.brief || undefined,
        _prior: anyStale ? (priorForRestore as string | undefined) : undefined,
      },
    };

    try {
      await save({
        data: {
          id,
          title: nextTitle,
          role_details: nextDetails,
          sharpen: nextSharpen,
          brief: nextBrief,
          status: nextStatus,
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }

    setSharpen(nextSharpen);
    setBrief(nextBrief);
    setDetails(nextDetails);
    setTitle(nextTitle);
    setStatus(nextStatus);
    loadedRef.current = snap(nextDetails, nextTitle, nextSharpen);
  }

  async function gotoStep(s: StepKey) {
    try {
      await persist({});
    } catch {
      return;
    }
    navigate({ to: "/briefs/$id", params: { id }, search: { step: s } });
  }
  const goto = (s: StepKey) =>
    navigate({ to: "/briefs/$id", params: { id }, search: { step: s } });

  if (loading) {
    return (
      <AppShell>
        <div className="text-sm text-muted-foreground">Loading brief…</div>
      </AppShell>
    );
  }

  // Determine "outdated source" for the banner: nearest earlier stale/edited
  // step is the trigger — but we just say the previous step name, which is
  // accurate for any single-step regression flow.
  const outdatedSourceFor = (s: StaleField): string => {
    if (s === "sharpen") return STEP_LABELS.details;
    if (s === "tech") return STEP_LABELS.sharpen;
    return STEP_LABELS.tech;
  };

  const dismissStale = (s: StaleField) => persist({ clearStale: [s] });

  async function updateAssignee(next: string | null) {
    const prev = assignedTo;
    setAssignedTo(next);
    try {
      await save({ data: { id, assigned_to: next } });
    } catch (e) {
      setAssignedTo(prev);
      toast.error((e as Error).message);
    }
  }

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/briefs/${id}` : `/briefs/${id}`;

  return (
    <AppShell>
      <div className="flex items-center justify-between gap-3 mb-4">
        <Link to="/briefs" className="text-xs text-muted-foreground hover:text-foreground">
          ← All briefs
        </Link>
        <div className="flex items-center gap-2">
          <AssigneePicker
            value={assignedTo}
            options={recruiters}
            currentUserId={currentProfile?.id ?? null}
            ownerId={ownerId}
            onChange={updateAssignee}
          />
          <button
            onClick={() => setShareOpen(true)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
          >
            Share
          </button>
          <StatusPill status={status} />
        </div>
      </div>
      {shareOpen && <ShareDialog url={shareUrl} title={title} onClose={() => setShareOpen(false)} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NavStepper
          current={currentStep}
          reached={reached}
          stale={staleFlags}
          onJump={(s) => void gotoStep(s)}
        />
        <Link
          to="/briefs/$id/candidates"
          params={{ id }}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary"
        >
          Candidate Pool →
        </Link>
      </div>




      {step === "details" && (
        <StepDetails
          title={title}
          setTitle={setTitle}
          details={details}
          setDetails={setDetails}
          onNext={async () => {
            await persist({ title: title || details.title, role_details: details });
            goto("sharpen");
          }}
        />
      )}
      {step === "sharpen" && (
        <StepReadTheCV
          details={details}
          sharpen={sharpen}
          setSharpen={setSharpen}
          outdated={staleFlags.sharpen === true}
          outdatedSource={outdatedSourceFor("sharpen")}
          onDismissOutdated={() => void dismissStale("sharpen")}
          onBack={() => goto("details")}
          onNext={async () => {
            await persist({
              sharpen,
              status: status === "draft" ? "sharpened" : status,
            });
            goto("tech");
          }}
          persistSharpen={(s, opts) =>
            persist({ sharpen: s, clearStale: opts?.regenerated ? ["sharpen"] : undefined })
          }
        />
      )}
      {step === "tech" && (
        <StepTech
          details={details}
          tech={tech}
          setTech={setTech}
          outdated={staleFlags.tech === true}
          outdatedSource={outdatedSourceFor("tech")}
          onDismissOutdated={() => void dismissStale("tech")}
          onBack={() => goto("sharpen")}
          onNext={async () => {
            await persist({ sharpen });
            goto("brief");
          }}
          persistTech={async (t, opts) => {
            await persist({
              sharpen: { ...sharpen, technologies: t.technologies ?? [] },
              clearStale: opts?.regenerated ? ["tech"] : undefined,
            });
          }}
        />
      )}
      {step === "brief" && (
        <StepBrief
          persistBrief={(b, opts) =>
            persist({ brief: b, clearStale: opts?.regenerated ? ["brief"] : undefined })
          }
          details={details}
          sharpen={sharpen}
          tech={tech}
          brief={brief}
          setBrief={setBrief}
          outdated={staleFlags.brief === true}
          outdatedSource={outdatedSourceFor("brief")}
          onDismissOutdated={() => void dismissStale("brief")}
          performedBy={performedBy}
          onBack={() => goto("tech")}
          onComplete={async () => {
            await persist({ brief, status: "complete" });
            toast.success("Brief marked complete.");
          }}
        />
      )}
    </AppShell>
  );
}

function StatusPill({ status }: { status: PersistedStatus }) {
  const map: Record<PersistedStatus, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-secondary text-muted-foreground" },
    sharpened: { label: "In progress", cls: "bg-secondary text-foreground" },
    complete: { label: "Complete", cls: "bg-success/15 text-success-foreground border border-success/40" },
    needs_review: {
      label: "Needs review",
      cls: "bg-[color:var(--accent-amber)]/15 text-foreground border border-[color:var(--accent-amber)]/50",
    },
  };
  const m = map[status] ?? map.draft;
  return (
    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " + m.cls}>
      Status: {m.label}
    </span>
  );
}

function NavStepper({
  current,
  reached,
  stale,
  onJump,
}: {
  current: 1 | 2 | 3 | 4;
  reached: { sharpen: boolean; tech: boolean; brief: boolean };
  stale: StaleFlags;
  onJump: (s: StepKey) => void;
}) {
  const steps: { n: 1 | 2 | 3 | 4; label: string; key: StepKey; stale: boolean; reached: boolean }[] = [
    { n: 1, label: STEP_LABELS.details, key: "details", stale: false, reached: true },
    { n: 2, label: STEP_LABELS.sharpen, key: "sharpen", stale: stale.sharpen === true, reached: reached.sharpen },
    { n: 3, label: STEP_LABELS.tech, key: "tech", stale: stale.tech === true, reached: reached.tech },
    { n: 4, label: STEP_LABELS.brief, key: "brief", stale: stale.brief === true, reached: reached.brief },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const state = current === s.n ? "current" : current > s.n ? "done" : "upcoming";
        const clickable = s.reached || current === s.n;
        return (
          <li key={s.n} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump(s.key)}
              title={
                !clickable
                  ? "Not yet generated"
                  : s.stale
                    ? "May be outdated — click to review"
                    : `Jump to ${s.label}`
              }
              className={
                "group flex items-center gap-2 rounded-md px-2 py-1 -mx-2 -my-1 transition " +
                (clickable ? "hover:bg-secondary cursor-pointer" : "cursor-not-allowed opacity-60")
              }
            >
              <span
                className={
                  "relative flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold " +
                  (state === "current"
                    ? "bg-primary text-primary-foreground"
                    : state === "done"
                      ? "bg-success text-success-foreground"
                      : "bg-secondary text-muted-foreground")
                }
              >
                {s.n}
                {s.stale && (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background"
                    style={{ backgroundColor: "var(--accent-amber)" }}
                  />
                )}
              </span>
              <span
                className={
                  "flex items-center gap-1.5 " +
                  (state === "upcoming" && !s.reached
                    ? "text-muted-foreground"
                    : "text-foreground font-medium")
                }
              >
                {s.label}
                {s.stale && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{
                      backgroundColor: "color-mix(in oklab, var(--accent-amber) 18%, transparent)",
                      color: "var(--foreground)",
                    }}
                  >
                    Needs review
                  </span>
                )}
              </span>
            </button>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

function OutdatedBanner({
  source,
  onRegenerate,
  onDismiss,
  regenLabel,
  regenerating,
}: {
  source: string;
  onRegenerate: () => void;
  onDismiss: () => void;
  regenLabel: string;
  regenerating: boolean;
}) {
  return (
    <div
      className="mt-6 rounded-lg border p-4 flex items-start gap-3"
      style={{
        borderColor: "color-mix(in oklab, var(--accent-amber) 50%, transparent)",
        backgroundColor: "color-mix(in oklab, var(--accent-amber) 10%, transparent)",
      }}
    >
      <span
        aria-hidden
        className="mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: "var(--accent-amber)" }}
      />
      <div className="flex-1 text-sm text-foreground">
        This was generated before a recent change to <span className="font-semibold">{source}</span>.
        Regenerate to reflect the update?
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onDismiss}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary"
        >
          Keep as is
        </button>
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          {regenerating ? "Regenerating…" : regenLabel}
        </button>
      </div>
    </div>
  );
}

// Kept for /new which imports it via ./new — no changes needed there.


function StepDetails({
  title,
  setTitle,
  details,
  setDetails,
  onNext,
}: {
  title: string;
  setTitle: (v: string) => void;
  details: RoleDetails;
  setDetails: (v: RoleDetails) => void;
  onNext: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="mt-6 rounded-lg border border-border bg-card p-6">
      <div className="mb-4">
        <label className="block text-xs font-medium text-foreground mb-1.5">Brief title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <RoleDetailsForm value={details} onChange={setDetails} />
      <div className="mt-6 flex justify-end">
        <button
          onClick={async () => {
            setSaving(true);
            try {
              await onNext();
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue → Read the CV"}
        </button>
      </div>
    </div>
  );
}

type AiDimensionOut = {
  key: DimensionKey;
  default_relevant: boolean;
  default_weight: Weight;
  suggested_specifics: string[];
};

function mergeAiIntoDimensions(
  current: DimensionState[] | undefined,
  ai: AiDimensionOut[],
): DimensionState[] {
  const byKey = new Map(ai.map((a) => [a.key, a]));
  return DIMENSIONS.map((meta) => {
    const a = byKey.get(meta.key);
    const existing = current?.find((d) => d.key === meta.key);
    const suggested = a?.suggested_specifics ?? [];
    // Reset selections when regenerating: keep only custom specifics.
    return {
      key: meta.key,
      relevant: a?.default_relevant ?? existing?.relevant ?? false,
      weight: a?.default_weight ?? existing?.weight ?? "nice_to_have",
      suggested_specifics: suggested,
      selected_specifics: suggested, // pre-select all suggested by default
      custom_specifics: existing?.custom_specifics ?? [],
    };
  });
}

function defaultDimensionState(key: DimensionKey): DimensionState {
  return {
    key,
    relevant: false,
    weight: "nice_to_have",
    suggested_specifics: [],
    selected_specifics: [],
    custom_specifics: [],
  };
}

function normalizeDimensions(current: DimensionState[] | undefined): DimensionState[] {
  return DIMENSIONS.map((meta) => ({
    ...defaultDimensionState(meta.key),
    ...current?.find((d) => d.key === meta.key),
    key: meta.key,
  }));
}

function StepReadTheCV({
  details,
  sharpen,
  setSharpen,
  onBack,
  onNext,
  persistSharpen,
  outdated,
  outdatedSource,
  onDismissOutdated,
}: {
  details: RoleDetails;
  sharpen: Sharpen;
  setSharpen: (s: Sharpen) => void;
  onBack: () => void;
  onNext: () => Promise<void>;
  persistSharpen: (s: Sharpen, opts?: { regenerated?: boolean }) => Promise<void>;
  outdated: boolean;
  outdatedSource: string;
  onDismissOutdated: () => void;
}) {
  const run = useServerFn(sharpenBrief);
  const [generating, setGenerating] = useState(false);

  async function generate() {
    setGenerating(true);
    try {
      const out = (await run({ data: { role_details: details } })) as {
        dimensions: AiDimensionOut[];
      };
      const merged = mergeAiIntoDimensions(sharpen.dimensions, out.dimensions ?? []);
      const next: Sharpen = { dimensions: merged };
      setSharpen(next);
      await persistSharpen(next, { regenerated: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  const savedDimensions = sharpen.dimensions ?? [];
  const hasResults = savedDimensions.length > 0;
  const dimensions = hasResults ? normalizeDimensions(savedDimensions) : [];
  const anyRelevant = dimensions.some((d) => d.relevant);

  function updateDim(key: DimensionKey, patch: Partial<DimensionState>) {
    const next = dimensions.map((d) => (d.key === key ? { ...d, ...patch } : d));
    setSharpen({ ...sharpen, dimensions: next });
  }

  return (
    <div className="mt-6 space-y-6">
      {outdated && (
        <OutdatedBanner
          source={outdatedSource}
          onRegenerate={() => void generate()}
          onDismiss={onDismissOutdated}
          regenLabel={hasResults ? "Regenerate" : "Suggest specifics"}
          regenerating={generating}
        />
      )}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Read the CV</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Nine dimensions we scan every CV for. Turn on the ones that matter for this role,
              tune what &quot;good&quot; looks like within each, and set how heavily to weight it.
              These drive where we look in the next step.
            </p>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
          >
            {generating ? "Thinking…" : hasResults ? "Regenerate" : "Suggest specifics"}
          </button>
        </div>
      </div>

      {!hasResults && (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-sm text-muted-foreground">
          Click <span className="font-medium text-foreground">Suggest specifics</span> to have the
          AI pre-set which dimensions matter for this role and what to look for within each.
        </div>
      )}

      {hasResults && (
        <div className="space-y-3">
          {DIMENSIONS.map((meta, idx) => {
            const dim = dimensions.find((d) => d.key === meta.key);
            if (!dim) return null;
            return (
              <DimensionCard
                key={meta.key}
                index={idx + 1}
                meta={meta}
                dim={dim}
                onChange={(patch) => updateDim(meta.key, patch)}
              />
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!hasResults || !anyRelevant}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          Continue → Sourcing brief
        </button>
      </div>
    </div>
  );
}

function DimensionCard({
  index,
  meta,
  dim,
  onChange,
}: {
  index: number;
  meta: { key: DimensionKey; name: string; description: string };
  dim: DimensionState;
  onChange: (patch: Partial<DimensionState>) => void;
}) {
  const [customInput, setCustomInput] = useState("");
  const selected = new Set(dim.selected_specifics);

  function toggleSuggested(s: string) {
    const next = new Set(selected);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onChange({ selected_specifics: Array.from(next) });
  }

  function addCustom() {
    const v = customInput.trim();
    if (!v) return;
    if (dim.custom_specifics.includes(v)) {
      setCustomInput("");
      return;
    }
    onChange({ custom_specifics: [...dim.custom_specifics, v] });
    setCustomInput("");
  }

  function removeCustom(s: string) {
    onChange({ custom_specifics: dim.custom_specifics.filter((c) => c !== s) });
  }

  const on = dim.relevant;

  return (
    <div
      className={
        "rounded-lg border p-5 transition " +
        (on ? "border-border bg-card" : "border-border bg-card/40")
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className={"flex-1 " + (on ? "" : "opacity-60")}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground">
              {String(index).padStart(2, "0")}
            </span>
            <h3 className="text-sm font-semibold text-foreground">{meta.name}</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
        </div>
        <button
          onClick={() => onChange({ relevant: !on })}
          role="switch"
          aria-checked={on}
          className={
            "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition " +
            (on ? "bg-primary" : "bg-secondary")
          }
        >
          <span
            className={
              "inline-block h-5 w-5 transform rounded-full bg-background shadow transition " +
              (on ? "translate-x-5" : "translate-x-0.5")
            }
          />
        </button>
      </div>

      {on && (
        <div className="mt-4 space-y-4">
          {dim.suggested_specifics.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Suggested specifics
              </p>
              <div className="flex flex-wrap gap-2">
                {dim.suggested_specifics.map((s) => {
                  const isSel = selected.has(s);
                  return (
                    <button
                      key={s}
                      onClick={() => toggleSuggested(s)}
                      className={
                        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition " +
                        (isSel
                          ? "border-primary bg-accent text-foreground"
                          : "border-border bg-card text-muted-foreground hover:text-foreground")
                      }
                    >
                      {isSel ? "✓ " : "+ "}
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {dim.custom_specifics.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Your specifics
              </p>
              <div className="flex flex-wrap gap-2">
                {dim.custom_specifics.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-2 rounded-md border border-primary bg-accent px-2.5 py-1 text-xs text-foreground"
                  >
                    {s}
                    <button
                      onClick={() => removeCustom(s)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${s}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                + Add your own
              </label>
              <div className="flex gap-2">
                <input
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom();
                    }
                  }}
                  placeholder={`Specific to look for in ${meta.name.toLowerCase()}`}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                />
                <button
                  onClick={addCustom}
                  disabled={!customInput.trim()}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Weight
              </label>
              <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                {(Object.keys(WEIGHT_LABELS) as Weight[]).map((w) => (
                  <button
                    key={w}
                    onClick={() => onChange({ weight: w })}
                    className={
                      "px-2.5 py-1 text-xs rounded transition " +
                      (dim.weight === w
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {WEIGHT_LABELS[w]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepBrief({
  details,
  sharpen,
  tech,
  brief,
  setBrief,
  onBack,
  onComplete,
  persistBrief,
  outdated,
  outdatedSource,
  onDismissOutdated,
  performedBy,
}: {
  details: RoleDetails;
  sharpen: Sharpen;
  tech: Tech;
  brief: BriefOut;
  setBrief: (b: BriefOut) => void;
  performedBy: string;
  onBack: () => void;
  onComplete: () => Promise<void>;
  persistBrief: (b: BriefOut, opts?: { regenerated?: boolean }) => Promise<void>;
  outdated: boolean;
  outdatedSource: string;
  onDismissOutdated: () => void;
}) {
  const run = useServerFn(generateSourcingBrief);
  const findMore = useServerFn(findMoreCompanies);
  const [generating, setGenerating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [findingTier, setFindingTier] = useState<null | "tier_a" | "tier_b">(null);
  const [tierNotes, setTierNotes] = useState<{ tier_a?: string; tier_b?: string }>({});

  async function generate() {
    setGenerating(true);
    try {
      const out = (await run({
        data: {
          role_details: details,
          sharpen: { dimensions: sharpen.dimensions ?? [] },
          tech: { technologies: tech.technologies ?? [] },
        },
      })) as BriefOut;
      setBrief(out);
      await persistBrief(out, { regenerated: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  const has = !!brief.summary;

  return (
    <div className="mt-6 space-y-6">
      {outdated && (
        <OutdatedBanner
          source={outdatedSource}
          onRegenerate={() => void generate()}
          onDismiss={onDismissOutdated}
          regenLabel={has ? "Regenerate" : "Generate brief"}
          regenerating={generating}
        />
      )}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Sourcing brief</h2>
            <p className="text-sm text-muted-foreground mt-1">
              The strategy: who to target, where to look, what to say.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {has && (
              <button
                onClick={() =>
                  navigator.clipboard
                    .writeText(formatBriefText(details, brief))
                    .then(() => toast.success("Copied"))
                }
                className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-secondary"
              >
                Copy
              </button>
            )}
            <button
              onClick={generate}
              disabled={generating}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {generating ? "Thinking…" : has ? "Regenerate" : "Generate brief"}
            </button>
          </div>
        </div>
      </div>

      {has && (
        <div className="space-y-4">
          <SectionCard title="Summary" accent="primary">
            <p className="text-sm text-foreground whitespace-pre-wrap">{brief.summary}</p>
          </SectionCard>

          {brief.target_companies && (() => {
            const tc = brief.target_companies!;
            const roleTitle = details.title?.trim() || "role";
            const log = brief.search_log ?? [];
            const allCompanyNames: { tier: string; name: string }[] = [
              ...(tc.tier_a ?? []).map((c) => ({ tier: "tier_a", name: normalizeCompany(c).name })),
              ...(tc.tier_b ?? []).map((c) => ({ tier: "tier_b", name: normalizeCompany(c).name })),
            ];
            const totalCompanies = allCompanyNames.length;
            const searchedCompanies = allCompanyNames.filter(({ tier, name }) =>
              log.some((e) => e.channel_key === `company:${tier}:${name.toLowerCase()}`),
            ).length;
            const setLog = (next: SearchLogEntry[]) => {
              const updated = { ...brief, search_log: next };
              setBrief(updated);
              void persistBrief(updated);
            };
            const handleFindMore = async (tier: "tier_a" | "tier_b") => {
              setFindingTier(tier);
              try {
                const existing = (tc[tier] ?? []).map((c) => normalizeCompany(c).name).filter(Boolean);
                const avoid = tc.avoid ?? [];
                const out = await findMore({
                  data: {
                    role_details: details,
                    sharpen: { dimensions: sharpen.dimensions ?? [] },
                    tech: { technologies: tech.technologies ?? [] },
                    tier,
                    existing,
                    avoid,
                  },
                });
                const newOnes = out.companies ?? [];
                if (newOnes.length > 0) {
                  const updated: BriefOut = {
                    ...brief,
                    target_companies: {
                      ...tc,
                      [tier]: [...(tc[tier] ?? []), ...newOnes],
                    },
                  };
                  setBrief(updated);
                  await persistBrief(updated);
                }
                setTierNotes((n) => ({
                  ...n,
                  [tier]: out.exhausted
                    ? out.note?.trim() ||
                      "That's likely most of the realistic pool for this profile — consider broadening a dimension or location in step 2/3."
                    : "",
                }));
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setFindingTier(null);
              }
            };
            return (
              <SectionCard
                title="Target companies — where to look for their people"
                accent="teal"
                subtitle="Search these company names on LinkedIn, or check their team/about pages directly."
              >
                {totalCompanies > 0 && (
                  <div className="mb-3 text-xs text-muted-foreground">
                    {searchedCompanies} of {totalCompanies} companies searched
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <CompanyList
                    label="Tier A"
                    items={tc.tier_a}
                    tone="primary"
                    tierKey="tier_a"
                    log={log}
                    onLogChange={setLog}
                    roleTitle={roleTitle}
                    performedBy={performedBy}
                    onFindMore={() => handleFindMore("tier_a")}
                    finding={findingTier === "tier_a"}
                    note={tierNotes.tier_a}
                  />
                  <CompanyList
                    label="Tier B"
                    items={tc.tier_b}
                    tone="secondary"
                    tierKey="tier_b"
                    log={log}
                    onLogChange={setLog}
                    roleTitle={roleTitle}
                    performedBy={performedBy}
                    onFindMore={() => handleFindMore("tier_b")}
                    finding={findingTier === "tier_b"}
                    note={tierNotes.tier_b}
                  />
                  <CompanyList label="Avoid" items={tc.avoid?.map((a) => ({ name: a }))} tone="muted" tierKey="avoid" log={log} onLogChange={setLog} roleTitle={roleTitle} performedBy={performedBy} hideToggle />

                </div>
              </SectionCard>
            );
          })()}

          {brief.keywords && brief.keywords.length > 0 && (
            <SectionCard title="Keywords" accent="purple">
              <div className="flex flex-wrap gap-1.5">
                {brief.keywords.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs text-foreground"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </SectionCard>
          )}

          {(brief.boolean_search_recruiter || brief.boolean_search_standard || brief.boolean_search) && (
            <SectionCard title="Boolean search" accent="amber">
              <div className="space-y-4">
                <BooleanBlock
                  label="For LinkedIn Recruiter (licensed seats)"
                  value={brief.boolean_search_recruiter || brief.boolean_search || ""}
                />
                {brief.boolean_search_standard && (
                  <BooleanBlock
                    label="For standard LinkedIn search (no Recruiter license)"
                    value={brief.boolean_search_standard}
                    note="Use this in the search bar at the top of linkedin.com, then filter by People."
                  />
                )}
              </div>
            </SectionCard>
          )}

          {brief.channels && brief.channels.length > 0 && (
            <SectionCard title="Channels" accent="success">
              {(() => {
                const allChannels = brief.channels!;
                // Hide standalone Scholar/Semantic Scholar/dblp cards — they render
                // as secondary links inside the arXiv card instead.
                const channels = allChannels.filter(
                  (c) => !/^(google scholar|scholar|semantic scholar|semanticscholar|dblp)$/i.test(
                    c.name.trim(),
                  ),
                );
                const hasGithubChannel = channels.some((c) => /github/i.test(c.name));
                
                const repos = brief.github_repos ?? [];
                const reposError = brief.github_repos_error;
                const devArticles = brief.devto_articles ?? [];
                const devError = brief.devto_articles_error;
                const arxivPapers = brief.arxiv_papers ?? [];
                const arxivError = brief.arxiv_papers_error;
                const researchIsCs = brief.research_is_cs === true;
                const researchKw =
                  (brief.keywords && brief.keywords.slice(0, 3).join(" ")) || "";
                const encKw = encodeURIComponent(researchKw);
                const semanticScholarUrl = `https://www.semanticscholar.org/search?q=${encKw}`;
                const googleScholarUrl = `https://scholar.google.com/scholar?q=${encKw}&scisbd=1`;
                const dblpUrl = `https://dblp.org/search?q=${encKw}`;

                const renderRepos = () => (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Real GitHub repos to mine for contributors
                    </div>
                    {repos.length > 0 ? (
                      <ul className="space-y-2">
                        {repos.map((r) => (
                          <li key={r.url} className="text-sm">
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {r.full_name}
                            </a>
                            <span className="ml-2 text-xs text-muted-foreground">
                              ★ {r.stars.toLocaleString()}
                            </span>
                            {r.description && (
                              <div className="text-muted-foreground">{r.description}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No specific repos found — try the GitHub search link above.
                        {reposError ? ` (${reposError})` : ""}
                      </p>
                    )}
                  </div>
                );

                const renderDevto = () => (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Recent Dev.to articles matching this stack
                    </div>
                    {devArticles.length > 0 ? (
                      <ul className="space-y-2">
                        {devArticles.map((a) => (
                          <li key={a.url} className="text-sm">
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {a.title}
                            </a>
                            <div className="text-xs text-muted-foreground">
                              {a.author}
                              {a.tags.length > 0 && ` · ${a.tags.map((t) => `#${t}`).join(" ")}`}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No specific articles found — try the search link above.
                        {devError ? ` (${devError})` : ""}
                      </p>
                    )}
                  </div>
                );

                const renderArxiv = () => (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Recent arXiv papers in this area
                    </div>
                    {arxivPapers.length > 0 ? (
                      <ul className="space-y-2">
                        {arxivPapers.map((p) => (
                          <li key={p.url} className="text-sm">
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {p.title}
                            </a>
                            <div className="text-xs text-muted-foreground">
                              {p.authors.slice(0, 4).join(", ")}
                              {p.authors.length > 4 ? " et al." : ""}
                              {p.published && ` · ${p.published}`}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No specific papers found — try the search link above.
                        {arxivError ? ` (${arxivError})` : ""}
                      </p>
                    )}
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Also worth checking
                      </div>
                      <ul className="space-y-2 text-sm">
                        <li>
                          <a
                            href={semanticScholarUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Semantic Scholar
                          </a>
                          <div className="text-xs text-muted-foreground">
                            Best for seeing an author&apos;s full body of work and citation
                            graph, not just one paper.
                          </div>
                        </li>
                        <li>
                          <a
                            href={googleScholarUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Google Scholar
                          </a>
                          <div className="text-xs text-muted-foreground">
                            Sort by date for recent work and check &ldquo;Cited by&rdquo; to
                            gauge influence — but citation counts take years to build, so
                            don&apos;t penalise recent grads for a low number.
                          </div>
                        </li>
                        {researchIsCs && (
                          <li>
                            <a
                              href={dblpUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                              dblp
                            </a>
                            <div className="text-xs text-muted-foreground">
                              Faster than Scholar for scanning a CS researcher&apos;s full
                              publication list.
                            </div>
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                );

                return (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {channels.map((c) => {
                        const isGoogleXray = /^google( x-?ray)?$/i.test(c.name.trim());
                        const googleXray = brief.google_xray?.trim() || "";
                        const url = isGoogleXray && googleXray
                          ? `https://www.google.com/search?q=${encodeURIComponent(googleXray)}`
                          : channelUrl(c.name, {
                              query: c.query,
                              keywords: brief.keywords,
                              boolean:
                                brief.boolean_search_standard ||
                                brief.boolean_search_recruiter ||
                                brief.boolean_search,
                            });
                        const isGithub = /github/i.test(c.name);
                        const isDevto = /dev\.to|^dev$/i.test(c.name);
                        const isArxiv = /arxiv/i.test(c.name);
                        const displayName = isGoogleXray ? "Google" : c.name;
                        const channelKey = `channel:${displayName.trim().toLowerCase()}`;
                        const logEntries = brief.search_log ?? [];
                        const logEntry = logEntries.find((e) => e.channel_key === channelKey);
                        const isDone = !!logEntry;
                        const doneAt = logEntry?.created_at
                          ? new Date(logEntry.created_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })
                          : "";
                        const doneBy = logEntry?.performed_by;
                        const doneLabel = doneBy ? `✓ Done — ${doneBy}, ${doneAt}` : `✓ Done — ${doneAt}`;
                        const toggleDone = () => {
                          let next: SearchLogEntry[];
                          if (isDone) {
                            next = logEntries.filter((e) => e.channel_key !== channelKey);
                          } else {
                            const roleTitle = details.title?.trim() || "role";
                            const entry: SearchLogEntry = {
                              id: crypto.randomUUID(),
                              text: `${displayName} — ${roleTitle}`,
                              done: true,
                              created_at: new Date().toISOString(),
                              channel_key: channelKey,
                              performed_by: performedBy,
                            };
                            next = [entry, ...logEntries];
                          }
                          const updated = { ...brief, search_log: next };
                          setBrief(updated);
                          void persistBrief(updated);
                        };
                        return (
                          <div
                            key={c.name}
                            className={`relative rounded-md border bg-background p-4 transition ${
                              isDone
                                ? "border-l-4 border-l-success border-border opacity-75"
                                : "border-border"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={toggleDone}
                              className={`absolute top-2 right-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                                isDone
                                  ? "border-success bg-success/15 text-foreground"
                                  : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary"
                              }`}
                              title={isDone ? `Marked by ${doneBy ?? "someone"} — click to unmark` : "Mark this channel as covered"}
                            >
                              {isDone ? doneLabel : "Mark as done"}
                            </button>
                            <div className="pr-24 text-sm font-semibold">
                              {url ? (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary underline-offset-2 hover:underline"
                                >
                                  {displayName}
                                </a>
                              ) : (
                                <span className="text-foreground">{displayName}</span>
                              )}
                              {isGoogleXray && (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                  X-ray search (CVs &amp; resumes)
                                </span>
                              )}
                            </div>
                            {c.how && (
                              <p className="mt-1 text-sm text-muted-foreground">{c.how}</p>
                            )}
                            {isGoogleXray && googleXray && (
                              <div className="mt-3">
                                <BooleanBlock
                                  label="Google X-ray string"
                                  value={googleXray}
                                  note="Clicking the Google link above runs this search directly."
                                />
                              </div>
                            )}
                            {c.how_to_search && c.how_to_search.length > 0 && (
                              <div className="mt-3">
                                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  How to search here
                                </div>
                                <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
                                  {c.how_to_search.map((step, i) => (
                                    <li key={i}>{step}</li>
                                  ))}
                                </ol>
                              </div>
                            )}
                            {isGithub && renderRepos()}
                            {isDevto && renderDevto()}
                            {isArxiv && renderArxiv()}
                          </div>
                        );
                      })}


                    </div>
                    {!hasGithubChannel && (repos.length > 0 || reposError) && (
                      <div className="mt-4 rounded-md border border-border bg-background p-4">
                        <div className="text-sm font-semibold">GitHub</div>
                        {renderRepos()}
                      </div>
                    )}
                  </>
                );
              })()}
            </SectionCard>
          )}



          {brief.outreach_angle && (
            <SectionCard title="Outreach angle" accent="primary">
              <p className="text-sm text-foreground whitespace-pre-wrap">{brief.outreach_angle}</p>
            </SectionCard>
          )}

          {brief.red_flags && brief.red_flags.length > 0 && (
            <SectionCard title="Red flags" accent="destructive">
              <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                {brief.red_flags.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </SectionCard>
          )}

          <SearchLogCard
            entries={brief.search_log ?? []}
            performedBy={performedBy}
            onChange={(next) => {
              const updated = { ...brief, search_log: next };
              setBrief(updated);
              void persistBrief(updated);
            }}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </button>
        <button
          onClick={async () => {
            setCompleting(true);
            try {
              await onComplete();
            } finally {
              setCompleting(false);
            }
          }}
          disabled={!has || completing}
          className="rounded-md bg-success text-success-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {completing ? "Saving…" : "Mark complete"}
        </button>
      </div>
    </div>
  );
}

type Accent = "primary" | "success" | "destructive" | "amber" | "purple" | "teal";
const ACCENT_VAR: Record<Accent, string> = {
  primary: "var(--primary)",
  success: "var(--success)",
  destructive: "var(--destructive)",
  amber: "var(--accent-amber)",
  purple: "var(--accent-purple)",
  teal: "var(--accent-teal)",
};

function SectionCard({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle?: string;
  accent: Accent;
  children: React.ReactNode;
}) {
  const color = ACCENT_VAR[accent];
  return (
    <div
      className="rounded-lg border border-border bg-card p-5 border-l-4"
      style={{ borderLeftColor: color }}
    >
      <div className="mb-3">
        <h3
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color }}
        >
          {title}
        </h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function BooleanBlock({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <button
          onClick={() =>
            navigator.clipboard.writeText(value).then(() => toast.success("Copied"))
          }
          className="rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:bg-secondary"
        >
          Copy
        </button>
      </div>
      <pre className="text-xs bg-background border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap font-mono">
        {value}
      </pre>
      {note && <p className="text-[11px] text-muted-foreground mt-1.5">{note}</p>}
    </div>
  );
}

function channelUrl(
  name: string,
  ctx: { query?: string; keywords?: string[]; boolean?: string },
): string | null {
  const n = name.toLowerCase();
  const kw = (ctx.query && ctx.query.trim())
    || (ctx.keywords && ctx.keywords.slice(0, 3).join(" "))
    || "";
  const enc = (s: string) => encodeURIComponent(s);

  if (n.includes("linkedin recruiter") || (n.includes("linkedin") && n.includes("recruiter"))) {
    // Recruiter is behind auth; deep link to LinkedIn people search as best-effort fallback
    return `https://www.linkedin.com/search/results/people/?keywords=${enc(ctx.boolean || kw)}`;
  }
  if (n.includes("linkedin")) {
    return `https://www.linkedin.com/search/results/people/?keywords=${enc(ctx.boolean || kw)}`;
  }
  if (n.includes("github")) {
    return `https://github.com/search?q=${enc(kw)}&type=users`;
  }
  if (n.includes("sourcegraph")) {
    return `https://sourcegraph.com/search?q=${enc(kw)}`;
  }
  if (n.includes("stack overflow") || n.includes("stackoverflow")) {
    return `https://stackoverflow.com/search?q=${enc(kw)}`;
  }
  if (n.includes("hacker news") || n === "hn" || n.includes("who is hiring")) {
    return `https://hn.algolia.com/?q=${enc(kw)}`;
  }
  if (n.includes("dev.to") || n === "dev") {
    return `https://dev.to/search?q=${enc(kw)}`;
  }
  if (n.includes("medium")) {
    const tag = kw.trim().split(/\s+/)[0]?.toLowerCase();
    return tag ? `https://medium.com/tag/${enc(tag)}` : `https://medium.com/search?q=${enc(kw)}`;
  }
  if (n.includes("hashnode")) {
    return `https://hashnode.com/search?q=${enc(kw)}`;
  }
  if (n.includes("twitter") || n.includes("x/") || n === "x" || n.includes(" x ") || n.startsWith("x ") || n.includes("x (twitter)")) {
    return `https://x.com/search?q=${enc(kw)}&f=user`;
  }
  if (n.includes("work at a startup") || n.includes("workatastartup") || n.includes("y combinator")) {
    return `https://www.workatastartup.com/companies?query=${enc(kw)}`;
  }
  if (n.includes("product hunt") || n.includes("producthunt")) {
    return `https://www.producthunt.com/search?q=${enc(kw)}`;
  }
  if (n.includes("hugging face") || n.includes("huggingface")) {
    return `https://huggingface.co/search/full-text?q=${enc(kw)}&type=user`;
  }
  if (n.includes("arxiv")) {
    return `https://arxiv.org/search/?query=${enc(kw)}&searchtype=all`;
  }
  if (n.includes("semantic scholar") || n.includes("semanticscholar")) {
    return `https://www.semanticscholar.org/search?q=${enc(kw)}`;
  }
  if (n.includes("dblp")) {
    return `https://dblp.org/search?q=${enc(kw)}`;
  }
  if (n.includes("google scholar") || n === "scholar") {
    return `https://scholar.google.com/scholar?q=${enc(kw)}&scisbd=1`;
  }
  if (n.includes("meetup")) {
    return `https://www.meetup.com/find/?keywords=${enc(kw)}`;
  }
  if (n.includes("reddit")) {
    return `https://www.reddit.com/search/?q=${enc(kw)}&type=user`;
  }
  if (n.includes("kaggle")) {
    return `https://www.kaggle.com/search?q=${enc(kw)}`;
  }
  if (n.includes("indie hackers")) {
    return `https://www.indiehackers.com/search?q=${enc(kw)}`;
  }
  return null;
}

function normalizeCompany(c: Company | string): Company {

  return typeof c === "string" ? { name: c } : c;
}

function CompanyList({
  label,
  items,
  tone,
  tierKey,
  log,
  onLogChange,
  roleTitle,
  performedBy,
  hideToggle = false,
  onFindMore,
  finding = false,
  note,
}: {
  label: string;
  items?: (Company | string)[];
  tone: "primary" | "secondary" | "muted";
  tierKey: string;
  log: SearchLogEntry[];
  onLogChange: (next: SearchLogEntry[]) => void;
  roleTitle: string;
  performedBy: string;
  hideToggle?: boolean;
  onFindMore?: () => void | Promise<void>;
  finding?: boolean;
  note?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const badgeCls =
    tone === "primary"
      ? "bg-primary text-primary-foreground"
      : tone === "secondary"
        ? "bg-accent text-accent-foreground"
        : "bg-secondary text-muted-foreground";
  const all = (items ?? []).map(normalizeCompany);
  const LIMIT = 6;
  const visible = expanded ? all : all.slice(0, LIMIT);
  const overflow = all.length - LIMIT;

  const keyFor = (name: string) => `company:${tierKey}:${name.toLowerCase()}`;
  const toggle = (name: string) => {
    const key = keyFor(name);
    const existing = log.find((e) => e.channel_key === key);
    if (existing) {
      onLogChange(log.filter((e) => e.channel_key !== key));
    } else {
      const entry: SearchLogEntry = {
        id: crypto.randomUUID(),
        text: `${name} — ${roleTitle}`,
        done: true,
        created_at: new Date().toISOString(),
        channel_key: key,
        performed_by: performedBy,
      };
      onLogChange([entry, ...log]);
    }
  };

  return (
    <div>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeCls}`}>
        {label}
      </span>
      <ul className="mt-2 space-y-1.5 text-sm text-foreground">
        {visible.map((c, i) => {
          const entry = log.find((e) => e.channel_key === keyFor(c.name));
          const done = !!entry;
          const doneAt = entry
            ? new Date(entry.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })
            : "";
          const doneBy = entry?.performed_by;
          return (
            <li key={i} className="flex items-start gap-2">
              {!hideToggle && (
                <button
                  type="button"
                  onClick={() => toggle(c.name)}
                  title={done ? `Marked by ${doneBy ?? "someone"} on ${doneAt} — click to unmark` : "Mark as searched"}
                  className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none transition ${
                    done
                      ? "border-success bg-success/20 text-foreground"
                      : "border-border bg-background text-transparent hover:border-primary"
                  }`}
                >
                  ✓
                </button>
              )}
              <span className={!hideToggle && done ? "opacity-70" : ""}>
                <span className={`font-medium ${!hideToggle && done ? "line-through decoration-success/70" : ""}`}>{c.name}</span>
                {!hideToggle && done && (
                  <span className="ml-1 text-xs text-muted-foreground" title={new Date(entry!.created_at).toLocaleString()}>
                    ✓ {doneBy ? `${doneBy}, ${doneAt}` : doneAt}
                  </span>
                )}
                {c.hint && (
                  <span className="text-muted-foreground text-xs"> — {c.hint}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {overflow > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-primary hover:underline"
        >
          {expanded ? "Show less" : `See ${overflow} more`}
        </button>
      )}
      {onFindMore && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void onFindMore()}
            disabled={finding}
            className="text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {finding ? "Finding more…" : "+ Find more companies"}
          </button>
          {note && (
            <p className="mt-2 text-xs text-muted-foreground italic">{note}</p>
          )}
        </div>
      )}
    </div>
  );
}

function SearchLogCard({
  entries,
  onChange,
  performedBy,
}: {
  entries: SearchLogEntry[];
  onChange: (next: SearchLogEntry[]) => void;
  performedBy: string;
}) {
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const doneCount = entries.filter((e) => e.done).length;

  function add() {
    const text = input.trim();
    if (!text) return;
    const entry: SearchLogEntry = {
      id: crypto.randomUUID(),
      text,
      done: false,
      created_at: new Date().toISOString(),
      performed_by: performedBy,
    };
    onChange([entry, ...entries]);
    setInput("");
  }

  function toggle(id: string) {
    onChange(entries.map((e) => (e.id === id ? { ...e, done: !e.done } : e)));
  }
  function remove(id: string) {
    onChange(entries.filter((e) => e.id !== id));
  }
  function saveEdit(id: string) {
    const text = editingText.trim();
    if (!text) return;
    onChange(entries.map((e) => (e.id === id ? { ...e, text } : e)));
    setEditingId(null);
    setEditingText("");
  }

  return (
    <SectionCard
      title="Search log"
      accent="amber"
      subtitle={`${entries.length} searches logged, ${doneCount} marked done. Your workspace — track what you've actually run so you don't repeat it.`}
    >
      <div className="flex gap-2 mb-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Channel — Company/segment — Location (e.g. LinkedIn — Vercel — California)"
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          + Log a search
        </button>
      </div>

      {entries.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Nothing logged yet.</p>
      )}

      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
          >
            <input
              type="checkbox"
              checked={e.done}
              onChange={() => toggle(e.id)}
              className="h-4 w-4 accent-[color:var(--primary)]"
            />
            {editingId === e.id ? (
              <input
                autoFocus
                value={editingText}
                onChange={(ev) => setEditingText(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") saveEdit(e.id);
                  if (ev.key === "Escape") {
                    setEditingId(null);
                    setEditingText("");
                  }
                }}
                onBlur={() => saveEdit(e.id)}
                className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm"
              />
            ) : (
              <button
                onClick={() => {
                  setEditingId(e.id);
                  setEditingText(e.text);
                }}
                className={
                  "flex-1 text-left text-sm " +
                  (e.done ? "line-through text-muted-foreground" : "text-foreground")
                }
              >
                {e.text}
              </button>
            )}
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {e.performed_by ? `${e.performed_by} · ` : ""}
              {new Date(e.created_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
            <button
              onClick={() => remove(e.id)}
              className="text-[11px] text-muted-foreground hover:text-destructive"
              aria-label="Delete"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function formatBriefText(details: RoleDetails, b: BriefOut): string {
  const lines: string[] = [];
  lines.push(`# Sourcing brief — ${details.title}`);
  if (details.team || details.level) lines.push(`${details.level} · ${details.team}`.trim());
  lines.push("");
  if (b.summary) lines.push(`## Summary\n${b.summary}\n`);
  if (b.target_companies) {
    lines.push("## Target companies");
    const fmt = (c: Company | string) => {
      const n = normalizeCompany(c);
      return n.hint ? `${n.name} — ${n.hint}` : n.name;
    };
    if (b.target_companies.tier_a?.length)
      lines.push(`Tier A: ${b.target_companies.tier_a.map(fmt).join(", ")}`);
    if (b.target_companies.tier_b?.length)
      lines.push(`Tier B: ${b.target_companies.tier_b.map(fmt).join(", ")}`);
    if (b.target_companies.avoid?.length)
      lines.push(`Avoid: ${b.target_companies.avoid.join(", ")}`);
    lines.push("");
  }
  if (b.keywords?.length) lines.push(`## Keywords\n${b.keywords.join(", ")}\n`);
  const boolRec = b.boolean_search_recruiter || b.boolean_search;
  if (boolRec) lines.push(`## Boolean — Recruiter\n${boolRec}\n`);
  if (b.boolean_search_standard)
    lines.push(`## Boolean — Standard LinkedIn\n${b.boolean_search_standard}\n`);
  if (b.channels?.length) {
    lines.push("## Channels");
    b.channels.forEach((c) => lines.push(`- ${c.name}: ${c.how}`));
    lines.push("");
  }
  if (b.outreach_angle) lines.push(`## Outreach angle\n${b.outreach_angle}\n`);
  if (b.red_flags?.length) {
    lines.push("## Red flags");
    b.red_flags.forEach((r) => lines.push(`- ${r}`));
  }
  if (b.search_log?.length) {
    lines.push("\n## Search log");
    b.search_log.forEach((e) =>
      lines.push(`- [${e.done ? "x" : " "}] ${e.text}`),
    );
  }
  return lines.join("\n");
}

function StepTech({
  details,
  tech,
  setTech,
  onBack,
  onNext,
  persistTech,
  outdated,
  outdatedSource,
  onDismissOutdated,
}: {
  details: RoleDetails;
  tech: Tech;
  setTech: (t: Tech) => void;
  onBack: () => void;
  onNext: () => Promise<void>;
  persistTech: (t: Tech, opts?: { regenerated?: boolean }) => Promise<void>;
  outdated: boolean;
  outdatedSource: string;
  onDismissOutdated: () => void;
}) {
  const run = useServerFn(suggestTechnologies);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState("");

  const technologies = tech.technologies ?? [];
  const hasResults = technologies.length > 0;

  async function generate() {
    setGenerating(true);
    try {
      const out = (await run({ data: { role_details: details } })) as {
        technologies?: TechItem[];
      };
      const suggested = (out.technologies ?? []).map((t) => ({
        name: t.name,
        category: t.category ?? "",
        proficiency: (t.proficiency as Proficiency) ?? "working",
        weight: (t.weight as Weight) ?? "important",
      }));
      // Keep any custom-added rows the recruiter has that aren't in the new list.
      const suggestedNames = new Set(suggested.map((t) => t.name.toLowerCase()));
      const kept = technologies.filter((t) => !suggestedNames.has(t.name.toLowerCase()));
      const next: Tech = { technologies: [...suggested, ...kept] };
      setTech(next);
      await persistTech(next, { regenerated: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function updateTech(idx: number, patch: Partial<TechItem>) {
    const next = technologies.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    setTech({ technologies: next });
  }

  function removeTech(idx: number) {
    setTech({ technologies: technologies.filter((_, i) => i !== idx) });
  }

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    if (technologies.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      setCustomName("");
      return;
    }
    setTech({
      technologies: [
        ...technologies,
        {
          name,
          category: customCategory.trim(),
          proficiency: "working",
          weight: "important",
        },
      ],
    });
    setCustomName("");
    setCustomCategory("");
  }

  // Group by category (empty category becomes "Other")
  const grouped = new Map<string, { item: TechItem; idx: number }[]>();
  technologies.forEach((t, idx) => {
    const cat = t.category?.trim() || "Other";
    const arr = grouped.get(cat) ?? [];
    arr.push({ item: t, idx });
    grouped.set(cat, arr);
  });

  return (
    <div className="mt-6 space-y-6">
      {outdated && (
        <OutdatedBanner
          source={outdatedSource}
          onRegenerate={() => void generate()}
          onDismiss={onDismissOutdated}
          regenLabel={hasResults ? "Regenerate" : "Suggest technologies"}
          regenerating={generating}
        />
      )}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Tools &amp; Technologies</h2>
            <p className="text-sm text-muted-foreground mt-1">
              The concrete skill bar for this role — specific tools, languages, frameworks and
              platforms. Separate from how we read the CV. Sharpens the search strings and
              signals of excellence in the next step.
            </p>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
          >
            {generating ? "Thinking…" : hasResults ? "Regenerate" : "Suggest technologies"}
          </button>
        </div>
      </div>

      {!hasResults && (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-sm text-muted-foreground">
          Click <span className="font-medium text-foreground">Suggest technologies</span> to pull
          a starting list from the role details, or add your own below. Empty is fine for
          non-technical roles.
        </div>
      )}

      {hasResults && (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category} className="rounded-lg border border-border bg-card p-5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-3">
                {category}
              </p>
              <div className="space-y-2">
                {items.map(({ item, idx }) => (
                  <TechRow
                    key={`${item.name}-${idx}`}
                    item={item}
                    onChange={(patch) => updateTech(idx, patch)}
                    onRemove={() => removeTech(idx)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
          + Add your own technology
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="e.g. Kubernetes"
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          <input
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder="Category (optional)"
            className="w-full sm:w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          <button
            onClick={addCustom}
            disabled={!customName.trim()}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </button>
        <button
          onClick={async () => {
            setSaving(true);
            try {
              await persistTech(tech);
              await onNext();
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue → Sourcing brief"}
        </button>
      </div>
    </div>
  );
}

function TechRow({
  item,
  onChange,
  onRemove,
}: {
  item: TechItem;
  onChange: (patch: Partial<TechItem>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 rounded-md border border-border bg-background p-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {(Object.keys(PROFICIENCY_LABELS) as Proficiency[]).map((p) => (
            <button
              key={p}
              onClick={() => onChange({ proficiency: p })}
              className={
                "px-2 py-1 text-[11px] rounded transition " +
                (item.proficiency === p
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {PROFICIENCY_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {(Object.keys(WEIGHT_LABELS) as Weight[]).map((w) => (
            <button
              key={w}
              onClick={() => onChange({ weight: w })}
              className={
                "px-2 py-1 text-[11px] rounded transition " +
                (item.weight === w
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {WEIGHT_LABELS[w]}
            </button>
          ))}
        </div>
        <button
          onClick={onRemove}
          className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary"
          aria-label={`Remove ${item.name}`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function AssigneePicker({
  value,
  options,
  currentUserId,
  ownerId,
  onChange,
}: {
  value: string | null;
  options: { id: string; display_name: string | null }[];
  currentUserId: string | null;
  ownerId: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const labelFor = (id: string | null) => {
    if (!id) return "Unassigned";
    const p = options.find((o) => o.id === id);
    if (!p) return id === ownerId ? "Owner" : "Someone";
    const name = p.display_name || "Teammate";
    return id === currentUserId ? `${name} (you)` : name;
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
        title="Assign this brief to a teammate"
      >
        Assigned: <span className="text-primary">{labelFor(value)}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 max-h-72 overflow-auto rounded-md border border-border bg-popover shadow-md">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-secondary"
            >
              Unassigned
            </button>
            {options.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs hover:bg-secondary ${
                  value === p.id ? "bg-secondary" : ""
                }`}
              >
                <div className="font-medium text-foreground">
                  {p.display_name || "Teammate"}
                  {p.id === currentUserId && <span className="text-muted-foreground"> (you)</span>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ShareDialog({
  url,
  title,
  onClose,
}: {
  url: string;
  title: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed — select and copy manually.");
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-foreground">Share this brief</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Anyone on the Talent team can open{title ? ` “${title}”` : " this brief"} and edit it with you.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
          />
          <button
            onClick={copy}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
        <div className="mt-4 text-right">
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

