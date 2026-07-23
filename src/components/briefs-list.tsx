import { Link } from "@tanstack/react-router";

type ProfileLite = { display_name: string | null; avatar_url: string | null } | null;

export type BriefRow = {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  role_details: { title?: string; team?: string; level?: string } | Record<string, never>;
  owner?: ProfileLite;
  assignee?: ProfileLite;
  candidate_count?: number;
};


export function BriefsList({
  briefs,
  onDelete,
  showOwner,
  emptyLabel,
}: {
  briefs: BriefRow[] | null;
  onDelete?: (id: string) => void;
  showOwner?: boolean;
  emptyLabel: string;
}) {
  if (briefs === null) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  if (briefs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-secondary/60 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Role</th>
            <th className="text-left px-4 py-2 font-medium">Status</th>
            <th className="text-left px-4 py-2 font-medium">Assigned to</th>
            {showOwner && <th className="text-left px-4 py-2 font-medium">Owner</th>}
            <th className="text-left px-4 py-2 font-medium">Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {briefs.map((b) => (
            <tr key={b.id} className="border-t border-border hover:bg-secondary/30">
              <td className="px-4 py-3">
                <Link to="/briefs/$id" params={{ id: b.id }} className="font-medium text-foreground hover:text-primary">
                  {b.title || b.role_details?.title || "Untitled"}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StatusPill status={b.status} />
              </td>
              <td className="px-4 py-3">
                {b.assignee ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground">
                    {b.assignee.avatar_url && (
                      <img src={b.assignee.avatar_url} alt="" className="h-4 w-4 rounded-full" />
                    )}
                    {b.assignee.display_name || "Teammate"}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Unassigned</span>
                )}
              </td>
              {showOwner && (
                <td className="px-4 py-3 text-muted-foreground">
                  {b.owner?.display_name || "—"}
                </td>
              )}
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(b.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-3">
                  <Link
                    to="/briefs/$id/candidates"
                    params={{ id: b.id }}
                    className="text-xs text-muted-foreground hover:text-primary rounded border border-border px-2 py-1"
                  >
                    Candidates ({b.candidate_count ?? 0})
                  </Link>
                  {onDelete && (
                    <button
                      onClick={() => onDelete(b.id)}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </td>

            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label =
    status === "complete" ? "Complete" : status === "sharpened" ? "Sharpened" : "Draft";
  const cls =
    status === "complete"
      ? "bg-success/20 text-foreground"
      : status === "sharpened"
        ? "bg-accent text-accent-foreground"
        : "bg-secondary text-muted-foreground";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
