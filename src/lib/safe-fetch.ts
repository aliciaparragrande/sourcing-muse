// Server-side URL safety guard to prevent SSRF.
// - Only http/https
// - Reject IP-literal hosts in private/loopback/link-local/multicast ranges
// - Reject known-unsafe hostnames (localhost, *.local, metadata endpoints)
// - Follow redirects manually and re-validate each hop

const MAX_REDIRECTS = 5;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

function isBlockedIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a >= 224) return true; // multicast / reserved
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isBlockedIPv6(host: string): boolean {
  // URL puts IPv6 in brackets; strip them.
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local
  if (h.startsWith("fe80")) return true; // link-local
  if (h.startsWith("ff")) return true; // multicast
  // IPv4-mapped: ::ffff:a.b.c.d
  const v4 = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
  if (v4 && isBlockedIPv4(v4[1])) return true;
  return false;
}

export function assertSafeUrl(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = u.hostname.toLowerCase();
  if (!host) throw new Error("Invalid URL host");
  if (BLOCKED_HOSTNAMES.has(host)) throw new Error("Blocked host");
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Blocked host");
  }
  if (isBlockedIPv4(host)) throw new Error("Blocked IP range");
  if (u.hostname.startsWith("[") || host.includes(":")) {
    if (isBlockedIPv6(u.hostname)) throw new Error("Blocked IP range");
  }
  return u;
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  let currentUrl = assertSafeUrl(rawUrl).toString();
  const method = (init.method ?? "GET").toUpperCase();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      const next = new URL(loc, currentUrl);
      assertSafeUrl(next.toString());
      currentUrl = next.toString();
      // 303 → GET; 301/302 typically preserved but many clients switch to GET
      if (res.status === 303 && method !== "GET" && method !== "HEAD") {
        init = { ...init, method: "GET", body: undefined };
      }
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
