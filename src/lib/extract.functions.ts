import { createServerFn } from "@tanstack/react-start";
import { requireMrqDomain } from "@/integrations/supabase/mrq-domain-middleware";
import { safeFetch, assertSafeUrl } from "@/lib/safe-fetch";
import { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const MAX_TEXT_CHARS = 30_000;

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
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from AI");
  return content;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function extractJson(text: string): JsonValue {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fence ? fence[1] : text).trim();
  // Find first { or [ and matching last } or ]
  const start = raw.search(/[{[]/);
  if (start === -1) throw new Error("No JSON found in AI response");
  const openChar = raw[start];
  const closeChar = openChar === "{" ? "}" : "]";
  const end = raw.lastIndexOf(closeChar);
  if (end === -1 || end < start) throw new Error("Malformed JSON in AI response");
  raw = raw.slice(start, end + 1);
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    const repaired = raw
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x1F\x7F]/g, " ");
    return JSON.parse(repaired) as JsonValue;
  }
}


function stripHtml(html: string): string {
  // Remove script/style/nav/footer/aside/header blocks
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside|header|form)[\s\S]*?<\/\1>/gi, " ");

  // Prefer <main> or <article> content when present
  const main =
    cleaned.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
    cleaned.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
    cleaned;

  const text = main
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

const RoleSchema = z.object({
  title: z.string().default(""),
  level: z.string().default(""),
  team: z.string().default(""),
  location: z.string().default(""),
  
  must_haves: z.string().default(""),
  nice_to_haves: z.string().default(""),
  context: z.string().default(""),
});

async function mapTextToRole(sourceText: string) {
  const trimmed = sourceText.slice(0, MAX_TEXT_CHARS);
  const system = `You extract structured role details from a job description or role brief.
Return STRICT JSON only, matching this shape (all strings, use "" for anything not clearly stated):
{
  "title": string,
  "level": one of ["Junior","Mid","Senior","Staff","Principal","Lead","Head of","Director"] or "",
  "team": one of ["Research","Platform/Infra","Data Eng","Security","Product/UX","Growth","SRE","Risk/Fraud","Responsible Gambling","Other"] or "",
  "location": string,
  
  "must_haves": string (bullet-style lines separated by \\n, deal-breakers only),
  "nice_to_haves": string (bullet-style lines separated by \\n),
  "context": string (why the role exists / team context — ONLY if stated)
}
Rules:
- Do NOT invent comp numbers, locations, or team context. If not in the source, leave "".
- Prefer verbatim phrasing where sensible; condense long lists.
- "level" and "team" must match the enums exactly, or be "".`;

  const content = await callGateway({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Source text:\n\n${trimmed}` },
    ],
    response_format: { type: "json_object" },
  });
  const parsed = RoleSchema.parse(extractJson(content));
  const filled: string[] = [];
  (Object.keys(parsed) as (keyof typeof parsed)[]).forEach((k) => {
    if (parsed[k] && String(parsed[k]).trim()) filled.push(k);
  });
  return { role_details: parsed, filled_fields: filled };
}

export const extractFromText = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { text: string }) =>
    z.object({ text: z.string().min(20).max(200_000) }).parse(d),
  )
  .handler(async ({ data }) => mapTextToRole(data.text));

export const extractFromUrl = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { url: string }) =>
    z.object({ url: z.string().url().max(2000) }).parse(d),
  )
  .handler(async ({ data }) => {
    let html: string;
    try {
      assertSafeUrl(data.url);
      const res = await safeFetch(data.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; MrQSourcingBriefBuilder/1.0; +https://mrq.com)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      html = await res.text();
    } catch {
      throw new Error("Couldn't read that page — try pasting the text instead.");
    }
    const text = stripHtml(html);
    if (text.length < 100) {
      throw new Error("Couldn't read that page — try pasting the text instead.");
    }
    return mapTextToRole(text);
  });

export const extractFromFile = createServerFn({ method: "POST" })
  .middleware([requireMrqDomain])
  .inputValidator((d: { filename: string; mime: string; base64: string }) =>
    z
      .object({
        filename: z.string().max(500),
        mime: z.string().max(200),
        base64: z.string().max(30_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const buf = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const lowerName = data.filename.toLowerCase();
    const isPdf = data.mime.includes("pdf") || lowerName.endsWith(".pdf");
    const isDocx =
      data.mime.includes("officedocument.wordprocessingml") || lowerName.endsWith(".docx");

    let text = "";
    try {
      if (isPdf) {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(buf);
        const { text: pages } = await extractText(pdf, { mergePages: true });
        text = Array.isArray(pages) ? pages.join("\n\n") : pages;
      } else if (isDocx) {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({
          buffer: Buffer.from(buf),
        });
        text = result.value;
      } else {
        throw new Error("Only PDF or DOCX files are supported.");
      }
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("PDF") || msg.includes("DOCX")) throw e;
      throw new Error("Couldn't read that file — try pasting the text instead.");
    }

    if (!text || text.trim().length < 50) {
      throw new Error("Couldn't read that file — try pasting the text instead.");
    }
    return mapTextToRole(text);
  });
