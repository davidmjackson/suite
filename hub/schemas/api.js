// schemas/api.js — JSON API bodies. These routes keep their bespoke 400 bodies
// (asserted by existing tests); schemas coerce/trim only via inline safeParse.
import { z } from "zod";

export const exchangeSchema = z.object({
  launch_token: z.string().trim().min(1),
});

export const consumeSchema = z.object({
  central_session_id: z.string().trim().min(1),
});
