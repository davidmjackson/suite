// schemas/admin.js — admin console form bodies.
import { z } from 'zod';
import { EMAIL_RE } from './_patterns.js';
const trim = (v) => (typeof v === 'string' ? v.trim() : v);

export const createUserSchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.string().regex(EMAIL_RE),
  ),
  display_name: z
    .preprocess((v) => {
      const t = trim(v);
      return t === '' || t == null ? null : t;
    }, z.string().nullable())
    .default(null),
  is_admin: z
    .preprocess((v) => (v === '1' ? 1 : 0), z.union([z.literal(0), z.literal(1)]))
    .default(0),
});

export const rejectRequestSchema = z.object({
  review_note: z
    .preprocess((v) => {
      const t = trim(v);
      return t === '' || t == null ? null : t;
    }, z.string().nullable())
    .default(null),
});
