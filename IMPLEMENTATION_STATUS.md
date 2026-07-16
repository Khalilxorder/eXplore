# eXplore Implementation Status

Updated: 2026-07-15

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
- [x] CQ-8 Canonical backend test runner ignores Windows ` (1).test.js` duplicates
- [x] CQ-9 Latest-news visibility capped at 72 hours across Home feed paths
- [x] CQ-10 Discovery candidates older than 72 hours hidden/stale
- [x] CQ-11 Gemini multi-key failover + request timeout + disabled-key cool-down
- [x] CQ-12 Verify lock + `scripts/run-verify.mjs` single-pipeline runner

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
- [x] Phase 8 — Life Directed Intelligence spine (contract, topics, Source Web, cycle, explanations)
- [x] Phase 9 — Feed reliability finalize (72h news age, discovery health, YouTube key rotation)

## Final product contract areas

| Area | Status | Proof |
|---|---|---|
| News | Verified locally (72h max visible age) | `npm run test:news-page` / frontend verifiers |
| Notifications | Backend verified; physical FCM device proof external | push + radar tests |
| Messages | UI + schema verified | private messaging verifiers/tests |
| You / Profile | Hierarchy + mode verified | hierarchy tests |
| Rules | Template system verified | template-system tests |
| Sources | Status/packs verified | readiness + sourcePacks tests |
| YouTube | Service verified (key rotation + public fallback) | youtubeService tests |
| Music / Xperience | Verified | xSuite + music tests |
| Shared Experience | Verified | shared experience tests |
| Jobs / Scholarships | Service verified | opportunities tests |
| Intelligence cycle | Verified | personalIntelligenceCycle tests |

## Remaining external / human gates (not code blockers)

1. Physical Android: notification permission, FCM delivery, deep links on a real device.
2. Live OAuth completion for Gmail/Meta when keys are present.
3. Hosted Supabase apply of `20260713_intelligence_spine.sql` and schema parity with local SQLite.
4. Authenticated release smoke with a real bearer token.
5. Optional: rebuild signed APK/AAB after this finalize (web+Android assets now aligned).

## Last verification snapshot (2026-07-16 close-out)

- Full pipeline: `npm run verify` green (lint, frontend, backend, build, android asset sync, news-page, smoke, release-contract)
- Frontend static verifiers: pass
- Backend tests: **247/247** pass
- ESLint errors: 0 (warnings only)
- Production build: pass — `explore-20260716001508-1d0f4382`
- Android web assets: synced to same build id (verify auto-copies after build)
- News-page verifier: pass (72h visibility, images, priority, scientist tool)
- Runtime smoke: pass (anonymous protected routes + official-releases)
- Gemini live probe: 11 unique keys; 7 immediate OK + 4×429 (rotation-safe); model `gemini-3.5-flash`
- Live API proof: health/readiness/messages/coverage/jobs all HTTP 200 on local backend
- Opportunities: miss_nothing 194 high-fit; scrapes may show stale until next `jobs/sweep`
- Definition of local-done: LDI spine + feed reliability + miss-nothing + live Gemini pool + verify green
- Hosted two-user messaging E2E + physical FCM remain external (see `FINAL_PROOF_2026-07-16.md`)
