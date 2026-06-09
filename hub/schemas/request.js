// schemas/request.js — POST /request access-request body.
import { z } from "zod";
import { EMAIL_RE } from "./_patterns.js";

export const APP_KEYS = ["poker", "retro", "signal", "raid"];

const trim = (v) => (typeof v === "string" ? v.trim() : v);
const optionalText = z.preprocess(
  (v) => { const t = trim(v); return t === "" || t == null ? null : t; },
  z.string().nullable()
).default(null);

export const requestSchema = z.object({
  company_name: z.preprocess(trim, z.string().min(1)),
  contact_name: z.preprocess(trim, z.string().min(1)),
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().regex(EMAIL_RE)
  ),
  job_title: optionalText,
  team_size: optionalText,
  message: optionalText,
  apps: z.preprocess(
    (v) => {
      let a = v;
      if (typeof a === "string") a = [a];
      return Array.isArray(a) ? a.filter((x) => APP_KEYS.includes(x)) : [];
    },
    z.array(z.enum(APP_KEYS))
  ).default([]),
});
