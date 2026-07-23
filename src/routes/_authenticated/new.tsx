import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { RoleDetailsForm, type RoleDetails, emptyRoleDetails } from "@/components/role-details-form";
import { QuickStart } from "@/components/quick-start";
import { createBrief } from "@/lib/briefs.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/new")({
  head: () => ({
    meta: [{ title: "New brief — Sourcing Brief Builder" }, { name: "robots", content: "noindex" }],
  }),
  component: NewBrief,
});

function NewBrief() {
  const navigate = useNavigate();
  const create = useServerFn(createBrief);
  const [details, setDetails] = useState<RoleDetails>(emptyRoleDetails());
  const [autofilled, setAutofilled] = useState<Set<keyof RoleDetails>>(new Set());
  const [saving, setSaving] = useState(false);

  function handleExtracted(next: RoleDetails, filled: (keyof RoleDetails)[]) {
    setDetails(next);
    setAutofilled(new Set(filled));
  }

  function handleFormChange(next: RoleDetails) {
    // Clear the "from JD" marker as soon as the recruiter edits a field.
    const stillAuto = new Set(autofilled);
    (Object.keys(next) as (keyof RoleDetails)[]).forEach((k) => {
      if (stillAuto.has(k) && next[k] !== details[k]) stillAuto.delete(k);
    });
    setAutofilled(stillAuto);
    setDetails(next);
  }

  async function handleContinue() {
    if (!details.title.trim()) {
      toast.error("Give the role a title.");
      return;
    }
    setSaving(true);
    try {
      const row = await create({ data: { role_details: details, title: details.title } });
      navigate({ to: "/briefs/$id", params: { id: row.id }, search: { step: "sharpen" } as never });
    } catch (e) {
      toast.error((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <Stepper current={1} />
      <div className="mt-6">
        <QuickStart onExtracted={handleExtracted} />
      </div>
      <div className="mt-6 rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold text-foreground">Role details</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review anything auto-filled and fill in the rest. Rough notes are fine — the AI will
          Review anything auto-filled and fill in the rest. Rough notes are fine — the AI will
          help you read CVs against it next.
        </p>
        <div className="mt-6">
          <RoleDetailsForm value={details} onChange={handleFormChange} autofilled={autofilled} />
        </div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleContinue}
            disabled={saving}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Continue → Read the CV"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}


export function Stepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = [
    { n: 1, label: "Role details" },
    { n: 2, label: "Read the CV" },
    { n: 3, label: "Tools & Technologies" },
    { n: 4, label: "Sourcing brief" },
  ] as const;
  return (
    <ol className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const state = current === s.n ? "current" : current > s.n ? "done" : "upcoming";
        return (
          <li key={s.n} className="flex items-center gap-2">
            <span
              className={
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold " +
                (state === "current"
                  ? "bg-primary text-primary-foreground"
                  : state === "done"
                    ? "bg-success text-success-foreground"
                    : "bg-secondary text-muted-foreground")
              }
            >
              {s.n}
            </span>
            <span
              className={
                state === "upcoming" ? "text-muted-foreground" : "text-foreground font-medium"
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="mx-2 h-px w-8 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
