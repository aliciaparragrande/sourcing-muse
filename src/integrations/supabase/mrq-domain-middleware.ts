// Server-side enforcement of the @mrq.com company-only access restriction.
// The client-side domain check in the auth routes is a UX guard only; this
// middleware is the authoritative check that runs on every server function
// call, so a non-mrq.com Google account cannot use a valid Supabase session
// to call our server APIs even if it never triggers the client sign-out.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";

const ALLOWED_DOMAIN = "mrq.com";

export const requireMrqDomain = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const claims = (context as { claims?: Record<string, unknown> }).claims ?? {};
    const email = typeof claims.email === "string" ? claims.email : "";
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    if (domain !== ALLOWED_DOMAIN) {
      throw new Error("Unauthorized: company account required");
    }
    return next();
  });
