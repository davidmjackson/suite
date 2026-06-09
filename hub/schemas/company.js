// schemas/company.js — company console form bodies.
import { z } from "zod";
import { EMAIL_RE } from "./_patterns.js";

export const inviteMemberSchema = z.object({
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.string().regex(EMAIL_RE)),
  role: z.enum(["owner", "member"]).default("member"),
});

export const memberRoleSchema = z.object({
  role: z.enum(["owner", "member"]),
});

export const teamNameSchema = z.object({
  name: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1)),
});

export const teamMemberSchema = z.object({
  userId: z.string().min(1),
});
