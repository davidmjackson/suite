# Sprint Suite Privacy Note — New Sections to Add (DRAFT)

> **STATUS: DRAFT — NOT LEGAL ADVICE.** AI-assisted first draft for solicitor
> review. `[BRACKETS]` mark details you must supply. These sections slot into the
> existing **Sprint Suite Data & Privacy Note**. Suggested placement noted on each.

---

## 1. ADD A NEW BLOCK: "AI processing (Sprintraid)"
*Place directly after the existing "What we process" block.*

**AI processing (Sprintraid).** To generate a RAID log, the text you paste into Sprintraid is sent to a third-party AI provider, **Anthropic**, via its commercial API (the Anthropic Messages API), which processes it to return structured RAID entries. We send only the text needed to perform the extraction. **We do not store your input or the generated RAID entries on our side: the text is processed in memory to fulfil your request and is not written to our database or to our logs (including error logs).** The AI provider processes the text under its own commercial terms: under those terms, API inputs and outputs are not used to train its models and are retained only for a short period before deletion [currently up to 7 days — confirm against the provider's current policy; do not state a number you cannot stand behind]. Because this text is processed by a third party, **please do not paste personal data, names of individuals, health or other special-category information, or confidential material into Sprintraid.** You are responsible for ensuring you are permitted to submit the text you paste.

> **Consider Zero Data Retention (ZDR).** If you qualify for the provider's ZDR
> arrangement, your input is not stored at rest at all beyond abuse screening, and
> you can drop the retention sentence above entirely. For a paste-text tool this is
> the strongest available privacy position — worth checking eligibility.

---

## 2. ADD A NEW BLOCK: "Sub-processors"
*Place after the "How it's used" block.*

**Sub-processors.** We use a small number of trusted third parties to provide the service. They process data only to perform their function and are bound by their own data-protection terms:

- **Resend** — sends sign-in (magic-link) and notification emails (processes email addresses).
- **Anthropic** — AI processing of text submitted to Sprintraid (Messages API).
- **IONOS** (United Kingdom) — hosts the application and stores service data (the Sprint Suite database). [Confirm the exact IONOS legal entity name for the contract.]

This list may change as the service evolves; the current version of this note applies.

---

## 3. ADD A NEW BLOCK: "International transfers"
*Place after "Sub-processors".*

**International transfers.** Some sub-processors may process data outside the UK. Where they do, we rely on an appropriate safeguard recognised under UK data-protection law (such as the UK [International Data Transfer Agreement / Addendum to the EU Standard Contractual Clauses], or an adequacy decision). **Application hosting (IONOS) is in the United Kingdom**, so no UK international-transfer safeguard is needed for hosting itself. (Confirmed 2026-06-04 via the production server's public IP geolocating to the UK with IONOS as the network operator; verify against the IONOS control panel/contract for the final published version, as IP geolocation is indicative rather than authoritative for data residency.) **Anthropic and Resend both process data in the United States**, so a UK transfer safeguard *is* required for those two. [Confirm the exact mechanism each US provider offers — UK IDTA vs EU SCCs + UK Addendum.]

---

## 4. ADD A NEW BLOCK: "Acceptance and authorisation logging"
*Place after the existing "Security" block.*

**Acceptance and authorisation logging.** When you confirm the authorisation checkbox at sign-in, we record limited technical information to evidence your agreement and protect against misuse: your account identifier, your IP address, the date and time, and the licence version you accepted. This is used only to maintain a record of acceptance and to investigate suspected misuse, and is retained for [STATE PERIOD].

> **Accuracy note (remove before publishing).** Two corrections against the current build:
> 1. **This feature is not built yet.** There is no authorisation checkbox at sign-in today and no acceptance event is recorded (it's planned alongside the licence/consent work). Publish this section only when that ships, so the note matches reality.
> 2. **Original draft said "request headers" — removed.** The audit log records account id, event type, app, a metadata field, timestamp, and IP — **not** request headers. Do **not** log full request headers: they carry the session cookie / auth token, so that would mean logging credentials. If you want a device hint, log only the `User-Agent` string and name it explicitly. (The logged IP is now the real client IP after the trust-proxy fix.)

---

## 5. FILL THE EXISTING GAPS

**Lawful basis (currently missing).** Add a short block, e.g.:

> **Our lawful basis.** Where UK/EU data-protection law applies, we process your
> data on the basis of [our legitimate interests in providing and securing the
> Software / performance of the licence you accept with us]. [Confirm basis with
> solicitor — legitimate interests vs contract.]

**Retention (currently bracketed).** State concrete periods. Verified against the current build (2026-06-04):

- **Sign-in sessions:** up to **30 days**, with automatic logout after **30 minutes** of inactivity. Magic-link sign-in tokens expire after **15 minutes**; invitation links after **7 days**.
- **Sprintraid input & generated entries:** **not stored** — processed in memory and discarded after the request (confirmed: no content database, and not written to logs, including error logs).
- **Sprintsignal survey data:** ⚠ currently retained **until manually deleted — no automatic expiry exists yet.** Choose a period and add a prune job before promising one, or state the "until deleted" position honestly.
- **Access requests and the authorisation/audit log:** ⚠ currently retained **indefinitely — no automatic expiry exists yet.** Same: set a period + prune job, or disclose indefinite retention.

Don't state a retention period the system doesn't actually enforce — either build the expiry (a prune job) or describe the real behaviour.

---

## Notes for the solicitor pass

- **AI disclosure is the highest-priority gap.** Free-text paste into Sprintraid is
  where users will most likely submit personal or confidential data, so the warning
  and the sub-processor disclosure need to be prominent, not buried.
- **The provider stance is favourable — use it.** Anthropic's commercial API does
  not train on inputs and deletes API inputs/outputs after a short window (currently
  ~7 days). The 5-year retention and training opt-in reported in the press apply to
  *consumer* Claude.ai accounts, not the API. State the API position, not the
  consumer one.
- **Zero Data Retention.** Check ZDR eligibility. If available, it removes at-rest
  storage and materially strengthens the privacy claim. Decide before publishing,
  because it changes the wording above.
- **Don't hard-code "7 days" as your own promise.** It is the provider's figure and
  may change. Reference "the provider's current terms" so your note can't go stale.
- **Does Sprintraid input get stored?** ✅ **VERIFIED 2026-06-04 (code review):** no.
  The raid app has no content database or tables (only the shared auth-client
  *session* store), and its sole server logs are Anthropic *error messages*
  (`err.message`) + a startup line — the pasted input and the generated entries are
  never written to disk or logged. Stated explicitly in §1. Strong privacy position.
- **Confirm transfer mechanism per provider.** Anthropic and Resend likely involve
  US processing; name the safeguard rather than leaving it generic.
- **Controller vs processor.** As flagged on the licence side: for Organisation
  customers you may be a processor for Input Data, which affects how this note is
  framed and whether a separate DPA is needed.
