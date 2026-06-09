// schemas/company.js — company console form bodies.
import { z } from "zod";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export const memberAppActionSchema = z.object({
  action: z.enum(["grant", "revoke"]),
});
