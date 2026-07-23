import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { listAllBriefs, deleteBrief } from "@/lib/briefs.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BriefsList } from "@/components/briefs-list";

export const Route = createFileRoute("/_authenticated/briefs/")({
  head: () => ({
    meta: [
      { title: "All briefs — Sourcing Brief Builder" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AllBriefs,
});

function AllBriefs() {
  const fetchAll = useServerFn(listAllBriefs);
  const del = useServerFn(deleteBrief);
  const router = useRouter();
  const [briefs, setBriefs] = useState<Awaited<ReturnType<typeof listAllBriefs>> | null>(null);

  useEffect(() => {
    fetchAll().then(setBriefs).catch((e) => toast.error(e.message));
  }, [fetchAll]);

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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">All briefs</h1>
        <p className="text-sm text-muted-foreground mt-1">Everything the Talent team is working on.</p>
      </div>
      <BriefsList briefs={briefs as never} showOwner onDelete={handleDelete} emptyLabel="No briefs yet. Be the first." />
    </AppShell>
  );
}
