// lib/consent.js
// Reads the visitor's analytics-consent choice from the request cookies.
//
// ss_consent is a preference record, not a tracker: it carries no identifier and
// is not linked to a user. Under PECR it is "strictly necessary" (it IS the record
// of the choice), so it needs no consent of its own — no chicken-and-egg.
//
// The one hard rule: anything that is not exactly "granted" or "denied" — absent,
// empty, tampered, or an unknown value — reads as null, meaning "ask again".
// This must never fail open to "granted".
import { parseCookies } from "./cookies.js";

export const CONSENT_COOKIE = "ss_consent";
export const CONSENT_GRANTED = "granted";
export const CONSENT_DENIED = "denied";

// 180 days. Consent is not indefinite; this re-asks roughly twice a year.
// Kept in sync with MAX_AGE in public/js/consent-banner.js.
export const CONSENT_MAX_AGE_SEC = 180 * 24 * 60 * 60;

export function readConsent(cookieHeader) {
  const v = parseCookies(cookieHeader)[CONSENT_COOKIE];
  if (v === CONSENT_GRANTED) return CONSENT_GRANTED;
  if (v === CONSENT_DENIED) return CONSENT_DENIED;
  return null;
}
