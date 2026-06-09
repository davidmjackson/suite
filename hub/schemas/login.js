// schemas/login.js — POST /login body. return_to is host-validated in the route
// (needs config.allowedAppDomains), so the schema only normalizes email + passes return_to through.
import { z } from "zod";
import { EMAIL_RE } from "./_patterns.js";

export const loginSchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().regex(EMAIL_RE)
  ),
  return_to: z.string().optional().default(""),
});
