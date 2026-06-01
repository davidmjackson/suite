// tests/access-requests.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTestApp } from "./helpers.js";
import { createAccessRequests } from "../lib/access-requests.js";

test("003 migration creates access_requests with expected columns", async () => {
  const { db } = await buildTestApp();
  const cols = db.prepare("PRAGMA table_info(access_requests)").all().map((c) => c.name);
  for (const c of [
    "id", "company_name", "contact_name", "email", "job_title", "team_size",
    "apps_interest", "message", "status", "created_at", "reviewed_by",
    "reviewed_at", "review_note", "company_id",
  ]) {
    assert.ok(cols.includes(c), `missing column ${c}`);
  }
  const v = db.prepare("SELECT MAX(version) AS v FROM schema_version").get().v;
  assert.ok(v >= 3, "schema_version should be >= 3");
});

test("createRequest inserts a pending row and serialises apps_interest", async () => {
  const { db } = await buildTestApp();
  const reqs = createAccessRequests(db);
  const r = reqs.createRequest({
    companyName: "IBM", contactName: "James", email: "james@ibm.com",
    jobTitle: "Scrum Master", teamSize: "11-50", appsInterest: ["poker", "retro"],
    message: "hi",
  });
  assert.equal(r.status, "pending");
  assert.equal(r.company_name, "IBM");
  assert.equal(JSON.parse(r.apps_interest).length, 2);
  assert.ok(r.created_at > 0);
});

test("listByStatus and getRequest", async () => {
  const { db } = await buildTestApp();
  const reqs = createAccessRequests(db);
  const a = reqs.createRequest({ companyName: "A", contactName: "x", email: "a@a.com" });
  reqs.createRequest({ companyName: "B", contactName: "y", email: "b@b.com" });
  const pending = reqs.listByStatus("pending");
  assert.equal(pending.length, 2);
  assert.equal(reqs.getRequest(a.id).company_name, "A");
  assert.equal(reqs.getRequest("nope"), null);
});

test("markReviewed updates status and stamps fields", async () => {
  const { db } = await buildTestApp();
  const reqs = createAccessRequests(db);
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("op1", "op1@test", Date.now());
  const a = reqs.createRequest({ companyName: "A", contactName: "x", email: "a@a.com" });
  const updated = reqs.markReviewed({ id: a.id, status: "rejected", reviewedBy: "op1", note: "spam" });
  assert.equal(updated.status, "rejected");
  assert.equal(updated.reviewed_by, "op1");
  assert.equal(updated.review_note, "spam");
  assert.ok(updated.reviewed_at > 0);
  assert.equal(reqs.listByStatus("pending").length, 0);
});
