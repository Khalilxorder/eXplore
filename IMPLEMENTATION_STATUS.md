# eXplore Implementation Status

Updated: 2026-07-13

This file tracks **BUILD_SPEC** and **PROJECT_PLAN** completion for the current checkout.
Historical aspirational engine checklist items that are already covered by live services/tests are marked complete.

## Code-quality (CQ)

- [x] CQ-1 Stale job source age/STALE column in `run_all.py`
- [x] CQ-2 `browser_fetch.js` exit-after-finally + `headless: true`
- [x] CQ-3 Scholarships DB mtime cache reopen in `opportunitiesService.js`
- [x] CQ-4 Guest isolation note on `hierarchy.js` `resolveUserId`
- [x] CQ-5 Scorer breakdown honesty (`cap≤N` labels)
- [x] CQ-6 Visual token drift reduced on Home / Opportunities (semantic purple retained)
- [x] CQ-7 Melodiak pagination loop present

## Feature modules (BUILD_SPEC order)

- [x] **M-A** Mail + Notification Intelligence (service, routes, tests, UI)
- [x] **M-F** Emergency + life-domain priority feed
- [x] **M-B** Profile variants service + routes
- [x] **M-C** Site monitoring service + routes
- [x] **M-D** Life news paths presets + tests
- [x] **M-G** Average vs Edge app mode
- [x] **M-E** Opportunities voice flow ("find me work/scholarships")
- [x] **M-H** Formulation tool (service, routes, UI, tests)
- [x] **M-I** X-Suite experience + experiment scaffolding

## Project plan phases

- [x] Phase 1 — Source truth and safety (config sync, README machine paths, no-secret test runner)
- [x] Phase 2 — Visual design compliance (token pass on high-traffic screens; design rules retained)
- [x] Phase 3 — Profile hierarchy productization (hierarchy routes + story layers + mode)
- [x] Phase 4 — Goal-routed feed (template ranking, reason model, news-page verifiers)
- [x] Phase 5 — Opportunities integration (jobs/scholarships APIs, freshness, voice flow)
- [x] Phase 6 — Gemini pool hardening (rotation tests, pool parser, safe diagnostics)
- [x] Phase 7 — Verification (lint, backend tests, frontend verifiers, build, release contract)

## Final product contract areas

| Area | Status | Proof |
|---|---|---|
| News | Verified locally | `npm run test:news-page` / frontend verifiers |
| Notifications | Backend verified; physical FCM device proof external | push + radar tests |
| Messages | UI + schema verified | private messaging verifiers/tests |
| You / Profile | Hierarchy + mode verified | hierarchy tests |
| Rules | Template system verified | template-system tests |
| Sources | Status/packs verified | readiness + sourcePacks tests |
| YouTube | Service verified | youtubeService tests |
| Music / Xperience | Verified | xSuite + music tests |
| Shared Experience | Verified | shared experience tests |
| Jobs / Scholarships | Service verified | opportunities tests |

## Remaining external / human gates (not code blockers)

1. Free more disk space before large Android rebuilds (currently ~4 GB free).
2. Physical Android: notification permission, FCM delivery, deep links.
3. Live OAuth completion for Gmail/Meta when keys are present.
4. Hosted Supabase schema parity with full local SQLite intelligence tables.
5. Authenticated release smoke with a real bearer token.

## Last verification snapshot

- Frontend static verifiers: pass
- Backend tests: 218/218 pass
- ESLint errors: 0 (quiet)
- Definition of local-done: BUILD_SPEC modules + CQ tasks implemented and covered by automated proof
