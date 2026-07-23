import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Link as LinkIcon, Upload, Sparkles } from "lucide-react";
import type { RoleDetails } from "@/components/role-details-form";
import { emptyRoleDetails } from "@/components/role-details-form";
import {
  extractFromFile,
  extractFromText,
  extractFromUrl,
} from "@/lib/extract.functions";

type Tab = "text" | "file" | "url";

export function QuickStart({
  onExtracted,
}: {
  onExtracted: (details: RoleDetails, filled: (keyof RoleDetails)[]) => void;
}) {
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const runText = useServerFn(extractFromText);
  const runUrl = useServerFn(extractFromUrl);
  const runFile = useServerFn(extractFromFile);

  function apply(result: { role_details: Partial<RoleDetails>; filled_fields: string[] }) {
    const merged: RoleDetails = { ...emptyRoleDetails(), ...result.role_details } as RoleDetails;
    onExtracted(merged, result.filled_fields as (keyof RoleDetails)[]);
    toast.success(
      result.filled_fields.length
        ? `Filled ${result.filled_fields.length} field${result.filled_fields.length === 1 ? "" : "s"} — review below.`
        : "Nothing confidently extractable — fill it in manually.",
    );
  }

  async function handleText() {
    if (text.trim().length < 20) {
      toast.error("Paste a bit more text — at least 20 characters.");
      return;
    }
    setBusy(true);
    try {
      apply(await runText({ data: { text } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUrl() {
    if (!url.trim()) {
      toast.error("Paste a URL.");
      return;
    }
    setBusy(true);
    try {
      apply(await runUrl({ data: { url: url.trim() } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    if (file.size > 15 * 1024 * 1024) {
      toast.error("File is too large (15MB max).");
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const base64 = btoa(binary);
      apply(
        await runFile({
          data: { filename: file.name, mime: file.type, base64 },
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "text", label: "Paste JD text", icon: <FileText className="h-4 w-4" /> },
    { id: "file", label: "Upload a file", icon: <Upload className="h-4 w-4" /> },
    { id: "url", label: "Paste a URL", icon: <LinkIcon className="h-4 w-4" /> },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Quick start (optional)</h2>
      </div>
      <p className="text-sm text-muted-foreground mt-1">
        Drop in a JD and we'll pre-fill what we can. Or skip it and fill the form below.
      </p>

      <div className="mt-4 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              "flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
              (tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "text" && (
          <div className="space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the full job description here…"
              rows={8}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleText}
                disabled={busy}
                className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Extracting…" : "Extract details"}
              </button>
            </div>
          </div>
        )}

        {tab === "file" && (
          <div className="space-y-3">
            <label
              className={
                "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-input py-10 cursor-pointer hover:bg-secondary/50 " +
                (busy ? "opacity-50 pointer-events-none" : "")
              }
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm text-foreground font-medium">
                Click to upload PDF or DOCX
              </span>
              <span className="text-xs text-muted-foreground">Max 15MB</span>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
            {busy && <p className="text-xs text-muted-foreground">Reading file…</p>}
          </div>
        )}

        {tab === "url" && (
          <div className="space-y-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://company.com/jobs/senior-backend-engineer"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleUrl}
                disabled={busy}
                className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Fetching…" : "Fetch & extract"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
