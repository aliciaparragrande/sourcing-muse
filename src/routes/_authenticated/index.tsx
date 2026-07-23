import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BriefsList, type BriefRow } from "@/components/briefs-list";
import { listMyBriefs, deleteBrief } from "@/lib/briefs.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "My briefs — Sourcing Brief Builder" },
      { name: "description", content: "Your MrQ sourcing briefs." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MyBriefs,
});

function MyBriefs() {
  const fetchMine = useServerFn(listMyBriefs);
  const del = useServerFn(deleteBrief);
  const router = useRouter();
  const [briefs, setBriefs] = useState<BriefRow[] | null>(null);

  useEffect(() => {
    fetchMine().then((rows) => setBriefs(rows as unknown as BriefRow[])).catch((e) => toast.error(e.message));
  }, [fetchMine]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this brief?")) return;
    try {
      await del({ data: { id } });
      setBriefs((b) => b?.filter((x) => x.id !== id) ?? null);
      router.invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <AppShell>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">My briefs</h1>
          <p className="text-sm text-muted-foreground mt-1">Drafts and finished briefs you own.</p>
        </div>
        <Link
          to="/new"
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          + New brief
        </Link>
      </div>
      <BriefsList briefs={briefs} onDelete={handleDelete} emptyLabel="You haven't started a brief yet." />
    </AppShell>
  );
}
