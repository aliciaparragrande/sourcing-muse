import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useServerFn } from "@tanstack/react-start";
import { getBrief } from "@/lib/briefs.functions";
import {
  listCandidates,
  upsertCandidate,
  updateCandidateStatus,
  updateCandidateOutreach,
  deleteCandidate,
  generateOutreach,
} from "@/lib/candidates.functions";
import { useCurrentProfile, displayNameOf } from "@/hooks/use-current-profile";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/briefs/$id/candidates")({
  head: () => ({
    meta: [
      { title: "Candidate Pool — Sourcing Brief Builder" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CandidatePoolPage,
});

type EvidenceType =
  | "github_repo"
  | "blog_post"
  | "research_paper"
  | "talk"
  | "personal_project"
  | "other";

const EVIDENCE_OPTIONS: { value: EvidenceType; label: string }[] = [
  { value: "github_repo", label: "GitHub repo/contribution" },
  { value: "blog_post", label: "Blog post" },
  { value: "research_paper", label: "Research paper" },
  { value: "talk", label: "Talk/conference" },
  { value: "personal_project", label: "Personal project" },
  { value: "other", label: "Other" },
];

type EvidenceItem = {
  type: EvidenceType;
  url: string;
  label?: string;
  fetch_status?: "ok" | "failed" | "empty";
  fetched_title?: string;
  fetched_excerpt?: string;
};

type Candidate = {
  id: string;
  brief_id: string;
  name: string;
  email: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  other_links: string[];
  evidence: EvidenceItem[];
  current_company_role: string | null;
  recruiter_notes: string;
  status: Status;
  outreach_message: string;
  outreach_sources: string[];
  added_by: string | null;
  added_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type Status =
  | "not_contacted"
  | "contacted"
  | "responded_interested"
  | "responded_not_interested"
  | "no_response";

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  not_contacted: { label: "Not contacted", cls: "bg-secondary text-muted-foreground" },
  contacted: {
    label: "Contacted",
    cls: "bg-secondary text-foreground border border-border",
  },
  responded_interested: {
    label: "Responded — interested",
    cls: "bg-success/15 text-success-foreground border border-success/40",
  },
  responded_not_interested: {
    label: "Responded — not interested",
    cls: "bg-destructive/10 text-foreground border border-destructive/40",
  },
  no_response: {
    label: "No response",
    cls: "bg-[color:var(--accent-amber)]/15 text-foreground border border-[color:var(--accent-amber)]/50",
  },
};

const STATUS_ORDER: Status[] = [
  "not_contacted",
  "contacted",
  "responded_interested",
  "responded_not_interested",
  "no_response",
];

function evidenceLabel(t: EvidenceType): string {
  return EVIDENCE_OPTIONS.find((o) => o.value === t)?.label ?? "Other";
}

function CandidatePoolPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const fetchBrief = useServerFn(getBrief);
  const fetchList = useServerFn(listCandidates);

  const [briefTitle, setBriefTitle] = useState<string>("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const currentProfile = useCurrentProfile();

  async function reload() {
    const rows = (await fetchList({ data: { brief_id: id } })) as Candidate[];
    setCandidates(rows);
  }

  useEffect(() => {
    fetchBrief({ data: { id } })
      .then((row) => setBriefTitle(row.title))
      .catch((e) => toast.error(e.message));
    reload().catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <AppShell>
      <div className="flex items-center justify-between gap-3 mb-4">
        <Link to="/briefs" className="text-xs text-muted-foreground hover:text-foreground">
          ← All briefs
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-xs text-muted-foreground">Brief</p>
          <h1 className="text-xl font-semibold text-foreground">{briefTitle || "Brief"}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              navigate({ to: "/briefs/$id", params: { id }, search: { step: "brief" } })
            }
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
          >
            ← Back to sourcing brief
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            + Add candidate
          </button>
        </div>
      </div>

      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">Candidate pool</h2>
        <p className="text-sm text-muted-foreground mt-1">
          A shortlist of people sourced for this role. Aim for 10-20 max — this isn&apos;t an ATS,
          just a place to track who you&apos;re reaching out to and why.
        </p>
      </div>

      {showAdd && (
        <CandidateForm
          brief_id={id}
          performedBy={displayNameOf(currentProfile)}
          onClose={() => setShowAdd(false)}
          onSaved={async () => {
            setShowAdd(false);
            await reload();
          }}
        />
      )}

      {candidates === null ? (
        <div className="text-sm text-muted-foreground">Loading candidates…</div>
      ) : candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No candidates yet. Add the first one you&apos;ve identified through sourcing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {candidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              expanded={expandedId === c.id}
              onExpand={() => setExpandedId(expandedId === c.id ? null : c.id)}
              onChanged={reload}
              performedBy={displayNameOf(currentProfile)}
              briefId={id}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function CandidateForm({
  brief_id,
  performedBy,
  onClose,
  onSaved,
  initial,
}: {
  brief_id: string;
  performedBy: string;
  onClose: () => void;
  onSaved: () => void;
  initial?: Candidate;
}) {
  const save = useServerFn(upsertCandidate);
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [linkedin, setLinkedin] = useState(initial?.linkedin_url ?? "");
  const [github, setGithub] = useState(initial?.github_url ?? "");
  const [evidence, setEvidence] = useState<EvidenceItem[]>(initial?.evidence ?? []);
  const [currentRole, setCurrentRole] = useState(initial?.current_company_role ?? "");
  const [notes, setNotes] = useState(initial?.recruiter_notes ?? "");
  const [saving, setSaving] = useState(false);

  function addEvidence() {
    setEvidence([...evidence, { type: "github_repo", url: "", label: "" }]);
  }
  function updateEvidence(i: number, patch: Partial<EvidenceItem>) {
    setEvidence(evidence.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  }
  function removeEvidence(i: number) {
    setEvidence(evidence.filter((_, j) => j !== i));
  }

  async function submit() {
    if (!name.trim()) {
      toast.error("Name is required.");
      return;
    }
    // Basic URL validation on evidence.
    for (const [i, ev] of evidence.entries()) {
      const u = ev.url.trim();
      if (!u) {
        toast.error(`Evidence #${i + 1} needs a URL.`);
        return;
      }
      try {
        new URL(u);
      } catch {
        toast.error(`Evidence #${i + 1}: not a valid URL.`);
        return;
      }
    }
    setSaving(true);
    try {
      await save({
        data: {
          id: initial?.id,
          brief_id,
          name: name.trim(),
          email: email.trim() || null,
          linkedin_url: linkedin.trim() || null,
          github_url: github.trim() || null,
          other_links: [],
          evidence: evidence.map((e) => ({
            type: e.type,
            url: e.url.trim(),
            label: (e.label ?? "").trim(),
            fetch_status: e.fetch_status,
            fetched_title: e.fetched_title,
            fetched_excerpt: e.fetched_excerpt,
          })),
          current_company_role: currentRole.trim() || null,
          recruiter_notes: notes,
          status: initial?.status ?? "not_contacted",
          added_by_name: performedBy,
        },
      });
      toast.success("Saved. Fetched content for any new evidence items.");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-border bg-card p-6">
      <h3 className="text-sm font-semibold text-foreground mb-4">
        {initial ? "Edit candidate" : "Add candidate"}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Name *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Current company / role">
          <input
            value={currentRole}
            onChange={(e) => setCurrentRole(e.target.value)}
            placeholder="e.g. Staff Engineer at Monzo"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Personal email">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="often found later"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="LinkedIn URL">
          <input
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="GitHub URL (profile page)">
          <input
            value={github}
            onChange={(e) => setGithub(e.target.value)}
            placeholder="https://github.com/username"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-semibold text-foreground">
            Specific things you found
          </label>
          <button
            type="button"
            onClick={addEvidence}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-secondary"
          >
            + Add another
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Concrete evidence — a specific repo, blog post, paper, or talk. We&apos;ll fetch its
          content so the outreach message can reference the actual thing rather than the platform.
        </p>
        {evidence.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
            No evidence yet. Add specific finds — e.g. a repo they contributed to, an article
            they wrote, or a paper they authored.
          </div>
        ) : (
          <div className="space-y-3">
            {evidence.map((ev, i) => (
              <div key={i} className="rounded-md border border-border p-3">
                <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2">
                  <select
                    value={ev.type}
                    onChange={(e) =>
                      updateEvidence(i, {
                        type: e.target.value as EvidenceType,
                        fetch_status: undefined,
                        fetched_title: "",
                        fetched_excerpt: "",
                      })
                    }
                    className="rounded-md border border-input bg-background px-2 py-2 text-sm"
                  >
                    {EVIDENCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={ev.url}
                    onChange={(e) =>
                      updateEvidence(i, {
                        url: e.target.value,
                        fetch_status: undefined,
                        fetched_title: "",
                        fetched_excerpt: "",
                      })
                    }
                    placeholder="https://…"
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeEvidence(i)}
                    className="rounded-md border border-border bg-card px-2 py-2 text-xs text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                </div>
                <input
                  value={ev.label ?? ""}
                  onChange={(e) => updateEvidence(i, { label: e.target.value })}
                  placeholder='Your short note, e.g. "Core contributor, not just a fork"'
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                />
                {ev.fetch_status && (
                  <div className="mt-2 text-xs">
                    {ev.fetch_status === "ok" ? (
                      <span className="text-success-foreground">
                        ✓ Verified{ev.fetched_title ? `: ${ev.fetched_title}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Couldn&apos;t verify content — outreach will stay general for this item.
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <label className="block text-xs font-medium text-foreground mb-1.5">
          Why this person is a good fit (your notes)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Your own judgment — what caught your eye, why they might be a match."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-secondary"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving & fetching…" : initial ? "Save changes" : "Add candidate"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function CandidateCard({
  candidate,
  expanded,
  onExpand,
  onChanged,
  performedBy,
  briefId,
}: {
  candidate: Candidate;
  expanded: boolean;
  onExpand: () => void;
  onChanged: () => Promise<void>;
  performedBy: string;
  briefId: string;
}) {
  const setStatus = useServerFn(updateCandidateStatus);
  const remove = useServerFn(deleteCandidate);
  const [editing, setEditing] = useState(false);

  async function onStatusChange(next: Status) {
    try {
      await setStatus({ data: { id: candidate.id, status: next } });
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete ${candidate.name} from this pool? This cannot be undone.`)) return;
    try {
      await remove({ data: { id: candidate.id } });
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const meta = STATUS_META[candidate.status];
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onExpand}
              className="text-sm font-semibold text-foreground hover:text-primary"
            >
              {candidate.name}
            </button>
            <span
              className={
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " + meta.cls
              }
            >
              {meta.label}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {candidate.current_company_role && <span>{candidate.current_company_role}</span>}
            {candidate.linkedin_url && (
              <a
                href={candidate.linkedin_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                LinkedIn
              </a>
            )}
            {candidate.github_url && (
              <a
                href={candidate.github_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                GitHub
              </a>
            )}
            {evidence.length > 0 && (
              <span>
                {evidence.length} evidence item{evidence.length === 1 ? "" : "s"}
              </span>
            )}
            {candidate.added_by_name && <span>Added by {candidate.added_by_name}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={candidate.status}
            onChange={(e) => void onStatusChange(e.target.value as Status)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
          <button
            onClick={onExpand}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-xs hover:bg-secondary"
          >
            {expanded ? "Hide" : "Details"}
          </button>
          <button
            onClick={onDelete}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground hover:text-destructive"
          >
            Delete
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {editing ? (
            <CandidateForm
              brief_id={briefId}
              performedBy={performedBy}
              initial={candidate}
              onClose={() => setEditing(false)}
              onSaved={async () => {
                setEditing(false);
                await onChanged();
              }}
            />
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Why they&apos;re a fit
                  </h4>
                  <button
                    onClick={() => setEditing(true)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Edit details
                  </button>
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {candidate.recruiter_notes || (
                    <span className="text-muted-foreground italic">No notes yet.</span>
                  )}
                </p>
              </div>

              {evidence.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Specific things you found
                  </h4>
                  <ul className="space-y-2">
                    {evidence.map((ev, i) => (
                      <li key={i} className="rounded-md border border-border p-3 text-xs">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-foreground">
                                {evidenceLabel(ev.type)}
                              </span>
                              {ev.fetch_status === "ok" ? (
                                <span className="text-success-foreground">✓ Verified</span>
                              ) : ev.fetch_status ? (
                                <span className="text-muted-foreground">
                                  Couldn&apos;t verify content
                                </span>
                              ) : null}
                            </div>
                            <a
                              href={ev.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block text-primary hover:underline truncate"
                            >
                              {ev.fetched_title || ev.url}
                            </a>
                            {ev.label && (
                              <p className="mt-1 text-muted-foreground italic">“{ev.label}”</p>
                            )}
                            {ev.fetched_excerpt && (
                              <p className="mt-1 text-foreground line-clamp-3">
                                {ev.fetched_excerpt}
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <OutreachBlock candidate={candidate} briefId={briefId} onChanged={onChanged} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OutreachBlock({
  candidate,
  briefId,
  onChanged,
}: {
  candidate: Candidate;
  briefId: string;
  onChanged: () => Promise<void>;
}) {
  const generate = useServerFn(generateOutreach);
  const saveMsg = useServerFn(updateCandidateOutreach);
  const [message, setMessage] = useState(candidate.outreach_message);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<{
    verified_urls: string[];
    unverified_urls: string[];
    sources_used: string[];
  } | null>(null);

  useEffect(() => {
    setMessage(candidate.outreach_message);
  }, [candidate.outreach_message]);

  async function run() {
    setBusy(true);
    try {
      const out = (await generate({
        data: { candidate_id: candidate.id, brief_id: briefId },
      })) as {
        message: string;
        sources_used: string[];
        verified_urls: string[];
        unverified_urls: string[];
      };
      setMessage(out.message);
      setMeta({
        verified_urls: out.verified_urls,
        unverified_urls: out.unverified_urls,
        sources_used: out.sources_used,
      });
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdits() {
    try {
      await saveMsg({ data: { id: candidate.id, outreach_message: message } });
      toast.success("Outreach message saved.");
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Copied.");
    } catch {
      toast.error("Copy failed.");
    }
  }

  const hasMessage = message.trim().length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Outreach message
        </h4>
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={busy}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? "Drafting…"
              : hasMessage
                ? "Regenerate"
                : "Generate outreach message"}
          </button>
        </div>
      </div>
      {hasMessage ? (
        <>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {meta && (
                <>
                  {meta.sources_used.length > 0 ? (
                    <span>Grounded in: {meta.sources_used.join(", ")}</span>
                  ) : (
                    <span>
                      No verified evidence used
                      {meta.unverified_urls.length > 0
                        ? ` (${meta.unverified_urls.length} unverified item${meta.unverified_urls.length === 1 ? "" : "s"} skipped)`
                        : ""}
                      — drafted from your notes and role only.
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={saveEdits}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary"
              >
                Save edits
              </button>
              <button
                onClick={copy}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary"
              >
                Copy
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Draft a personalized message grounded in this role, your notes, and any evidence
          you&apos;ve added. Unverified items are used only as loosely as your own label allows —
          the AI won&apos;t invent details it can&apos;t verify.
        </p>
      )}
    </div>
  );
}
