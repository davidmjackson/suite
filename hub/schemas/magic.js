// schemas/magic.js — POST /auth/magic body. Token must be a non-empty string.
import { z } from 'zod';
export const magicPostSchema = z.object({
  token: z.string().min(1),
});
