-- 004-ctm-role-gating.sql
-- Slice 2: collapse roles to owner|member and re-home Signal/RAID to per-user.
-- IMPORTANT: this file is exec'd on EVERY boot, so every statement must be
-- idempotent / safe to re-run.

-- 1. Collapse the admin tier into member (two-role model: owner | member).
UPDATE company_members SET role = 'member' WHERE role = 'admin';

-- 2. Re-home each company-level Signal/RAID grant to every owner of that
--    company at the user level (Signal unlimited, RAID keeps 25/month).
--    INSERT OR IGNORE + the UNIQUE(app,principal_type,principal_id) key makes
--    re-runs a no-op. After step 3 suspends the source rows, this SELECT is
--    empty on later boots anyway.
INSERT OR IGNORE INTO app_entitlements
  (id, app, principal_type, principal_id, status, quota_limit, quota_period, granted_by, granted_at)
SELECT lower(hex(randomblob(16))), ae.app, 'user', cm.user_id, 'active',
       ae.quota_limit, ae.quota_period, ae.granted_by, ae.granted_at
FROM app_entitlements ae
JOIN company_members cm
  ON cm.company_id = ae.principal_id AND cm.role = 'owner'
WHERE ae.principal_type = 'company'
  AND ae.status = 'active'
  AND ae.app IN ('signal', 'raid');

-- 3. Suspend the company-level Signal/RAID grants so members stop inheriting them.
UPDATE app_entitlements SET status = 'suspended'
WHERE principal_type = 'company'
  AND status = 'active'
  AND app IN ('signal', 'raid');
