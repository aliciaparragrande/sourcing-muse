// Server-side auth check for the demo version — requires a signed-in user,
// but no longer restricts access to a specific email domain.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";

export const requireMrqDomain = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next }) => {
    return next();
  });
