# Security scans

Reconciliations of external security scans against what the code actually does.

| Report                                                                   | Scan                                          | Outcome                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------- |
| [2026-08-25-zap-reconciliation.html](2026-08-25-zap-reconciliation.html) | ZAP 2.17.0, `sprintsuite.uk`, unauthenticated | 11 alerts: 1 fixed in response, 6 already fixed, 4 not defects |

## Why these live here

A scanner's report says what it saw from outside. It cannot see an Origin-header
CSRF guard, it cannot tell a public page from an authenticated one, and it dates
the moment it is generated rather than the moment it captured. Every alert
therefore needs an answer written against the code — including the alerts that
turn out not to be defects, because "we looked and here is why it is fine" is the
half that gets lost otherwise.

Open the HTML file in a browser. It is a standalone document; the only thing it
fetches is its typefaces from Google Fonts, and it degrades to system faces
offline.

## Writing the next one

Two things make these worth keeping rather than skimming:

- **Say what a fix did NOT repair.** Several of the changes here closed an alert
  without closing a vulnerability. A report that lets "item closed" read as "we
  were exposed and now we are not" is misleading in the direction that matters.
- **Record what the scan could not reach.** An unauthenticated scan finding
  nothing behind sign-in is absence of testing, not evidence of safety, and that
  belongs in the report rather than in someone's memory.
