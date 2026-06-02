// lib/provisioning.js
import { randomId, randomToken, now } from "./tokens.js";
import { createOrg } from "./org.js";
import { createEntitlements } from "./entitlements.js";
import { createAccessRequests } from "./access-requests.js";

// Apps every approved company gets at the COMPANY level (all members inherit).
const DEFAULT_COMPANY_APPS = [{ app: "poker" }, { app: "retro" }];
// Specialist apps granted to the first owner (CR) at the USER level. RAID is
// capped per-member (demo guardrail); members are enabled later in the console.
const DEFAULT_OWNER_APPS = [{ app: "signal" }, { app: "raid", quotaLimit: 25, quotaPeriod: "month" }];

export function slugify(name) {
  const base = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "company";
}

export function createProvisioner(db, { inviteTtlMs }) {
  const org = createOrg(db);
  const ent = createEntitlements(db);
  const reqs = createAccessRequests(db);

  function uniqueSlug(base) {
    let slug = base;
    let n = 2;
    while (org.getCompanyBySlug(slug)) {
      if (n > 1000) throw new Error("slug_collision_exhausted");
      slug = `${base}-${n}`;
      n += 1;
    }
    return slug;
  }

  // Synchronous (better-sqlite3 transaction). Email sending happens in the
  // route AFTER this returns, because it is async and must not be in the tx.
  const approve = db.transaction(({ requestId, grantedBy }) => {
    const reqRow = reqs.getRequest(requestId);
    if (!reqRow) return { ok: false, reason: "not_found" };
    if (reqRow.status !== "pending") return { ok: false, reason: "not_pending" };

    const slug = uniqueSlug(slugify(reqRow.company_name));
    const company = org.createCompany({ name: reqRow.company_name, slug });

    const email = reqRow.email.trim().toLowerCase();
    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      const id = randomId();
      db.prepare("INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)")
        .run(id, email, reqRow.contact_name || null, 0, now());
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    }

    org.addCompanyMember({ userId: user.id, companyId: company.id, role: "owner" });

    for (const a of DEFAULT_COMPANY_APPS) {
      ent.grantEntitlement({
        app: a.app,
        principalType: "company",
        principalId: company.id,
        quotaLimit: a.quotaLimit ?? null,
        quotaPeriod: a.quotaPeriod ?? null,
        grantedBy,
      });
    }
    for (const a of DEFAULT_OWNER_APPS) {
      ent.grantEntitlement({
        app: a.app,
        principalType: "user",
        principalId: user.id,
        quotaLimit: a.quotaLimit ?? null,
        quotaPeriod: a.quotaPeriod ?? null,
        grantedBy,
      });
    }

    const token = randomToken();
    const t = now();
    db.prepare("INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)")
      .run(token, email, null, t, t + inviteTtlMs);

    reqs.markReviewed({ id: requestId, status: "approved", reviewedBy: grantedBy, companyId: company.id });

    return { ok: true, company, user, token };
  });

  return { approve, uniqueSlug };
}
