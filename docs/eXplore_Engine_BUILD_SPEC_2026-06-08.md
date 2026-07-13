# eXplore Engine Build Spec — Final-Analysis Layers (B · C · D · E)

> Companion to `BUILD_SPEC.md` and the map in `eXplore_Final_Analysis_Map_2026-06-07.md`.
> Four **independent, parallel** modules. Each can be drafted by Gemini Flash in any order and
> degrades gracefully if the others are absent. **Workflow:** hand ONE module to Flash → it drafts →
> Claude verifies against that module's *Acceptance* + *Reviewer checklist* and runs `npm run verify`.

**Locked decisions (2026-06-08):** parallel modules · **hybrid** ranking (deterministic baseline +
Gemini refine + 1–10 feedback) · spider wakes on **change-detected + scheduled** · **Trends** = the
social/market trends Khalil cares about *as an artist* · a **Hunt** = a specific trend/place/idea with a
**high probability of being a real opportunity for him as an artist** (an opportunity-scored trend).

---

## 0. Golden rules (do not violate)

1. **Match existing patterns.** New backend route file mirrors `backend/src/routes/hierarchy.js`; register it in `backend/server.js` exactly like the others: `fastify.register(require('./src/routes/<name>'), { prefix: '/api/v1/<name>', db })`. If a GET must be public (no login), add its path to the public-routes allowlist near `backend/server.js:138`; otherwise it is auth-gated by default (`backend/src/auth/supabaseAuth.js` → `verifySupabaseAccessToken`, `getBearerToken`, `buildUnauthorizedResponse`).
2. **Every AI call goes through** `aiService.generateStructuredJson({ providerPreference: 'gemini', systemPrompt, userPrompt, model, temperature })` (`backend/services/aiService.js`) **and MUST have a deterministic fallback** that runs when the provider is unavailable. Never block a response on AI. Cache AI output by a content hash; never call AI in a tight loop.
3. **DB:** better-sqlite3. Add tables to `backend/schema.sqlite.sql` AND a migration step (mirror how the `private_*` tables are created). Keep a Supabase/postgres parallel where the feature is user-data (mirror `private_*`). Respect RLS — never expose another user's rows.
4. **Frontend:** screen wires in `src/app/page.js` via `screen === '<x>' && <XScreen/>` + `NAV_ITEMS`/`ROOT_SCREENS` in `src/app/components/AppShell.js`; all data via `apiFetch` helpers added to `src/app/lib/api.js`. Static export + Capacitor — use `<img>` for arbitrary remote images (the lint rule is already off via file-level directive). Follow the visual rules (clear containers, calm, no loose text).
5. **Never** hardcode secrets, add a dependency without need, show an **unverified external link** (verify live via HTTP/oEmbed before committing), or let a card render a broken/dead source.
6. **Green bar:** `npm run verify` (lint · frontend verifiers · `node --test` backend · build · runtime smoke) must stay green. Each module ships **one** `backend/test/<name>.test.js`.

## Architecture cheat-sheet (real anchors — verified 2026-06-08)

| Concern | Use / extend |
|---|---|
| AI (structured) | `backend/services/aiService.js` → `generateStructuredJson(...)`, `getAiProvider()` (9 Gemini keys, `gemini-2.5-flash-lite`) |
| Ranking / story layers | `backend/src/services/valueHierarchySync.js` (`buildDeterministicInterpretation`, `buildLayerSummary`, exports at L1047), routes `backend/src/routes/hierarchy.js` (`/api/v1/hierarchy/*`) |
| Change-detection / spider | `backend/src/services/siteMonitorService.js`, route `backend/src/routes/sites.js` (`/api/v1/sites`, `…/check-all`) |
| Discovery + worker | `backend/src/services/feedDiscoveryService.js`, `backend/discoveryWorker.js`, route `backend/src/routes/discovery.js` |
| Opportunity scoring (hunts) | `backend/opportunities/opportunitiesService.js` → `scoreScholarshipProfileFit` (L896), `compareScholarshipsByProfileFit` (L1042), `profile_match_score` |
| Lanes / domains | `backend/src/services/eventSourceMapService.js` (5 lanes: war, ai_advantage, markets, art_meaning, personal_opportunities) |
| Culture / artist data | `backend/src/services/cultureService.js` (route `culture.js`), `backend/src/services/musicStatsImportService.js` (route `musicStats.js`), `anomalyMath.js`/`anomalyFeedService.js` |
| Alerts/notify | `backend/src/services/priorityAlertStore.js`, `pushDeliveryService.js`, `privateMessengerNotificationService.js` |
| Frontend wiring | `src/app/page.js`, `src/app/components/AppShell.js`, `src/app/lib/api.js`; viz pattern: `src/app/components/MiddleEastSuccessGraph.js` |

---

## Module M-D — Final Theory (the ranking lens) · HYBRID

**Goal:** an editable "theory of me" that ranks everything, learns from 1–10 ratings, and shows *why* an item was surfaced.

**Data (sqlite + supabase parallel):**
- `theory_of_me(user_id PK, weights_json TEXT, updated_at TEXT)` — `weights_json` = `{ domains:{ai,home_safety,markets,culture,opportunities,meaning}, signals:{depth,rarity,freshness,timeless,goal_fit} }`, each 0..1.
- `value_ratings(id, user_id, item_id, item_type, rating INTEGER, reason TEXT, signals_json TEXT, created_at TEXT)`.

**Service `backend/src/services/finalTheoryService.js`:**
- `getTheoryOfMe(db, userId)` → weights (default seeded from `user_profile.json` + hierarchy goal).
- `scoreItemForUser(db, userId, item)` → `{ score, breakdown, why }`. Deterministic baseline = Σ(weightᵢ × itemSignalᵢ) using existing signals (analysis scores, lane, opportunity fit); **then** optional `generateStructuredJson` refine (cache by `item_id`); **then** apply learned deltas from ratings. `why` = one sentence ("Surfaced for *AI* + *high goal-fit*; you rated similar 8/10").
- `recordRating(db, {userId,itemId,itemType,rating,reason,signals})` → insert + nudge weights of the item's dominant signals toward (rating≥7) or away (rating≤4) by a small step; clamp 0..1.

**Routes `backend/src/routes/finalTheory.js` (`/api/v1/theory`)** — auth-gated:
- `GET /api/v1/theory` → `{ weights, recentRatings }`.
- `POST /api/v1/theory/rate` `{itemId,itemType,rating,reason}` → updated `{weights}`.
- `PUT /api/v1/theory` `{weights}` → save manual edits.

**Frontend:** `src/app/lib/api.js`: `fetchTheory()`, `rateItem(payload)`, `updateTheory(weights)`. A reusable `<RateControl item />` (1–10 + reason) added to cards on Home, Written News, Priority Radar, Opportunities, Detail, and the figures cards. New screen `theory` (`TheoryOfMeScreen`): editable weight sliders + rating history + live "why ranked" examples.

**Acceptance:** rating an item visibly reorders it and similar items on next load (persisted); every ranked surface can show a "why"; with AI off, deterministic scores still rank and explain.
**Test `finalTheoryService.test.js`:** deterministic score is stable; a 9/10 rating raises that signal's weight; a 2/10 lowers it; AI-off path returns a score+why.
**Reviewer checklist (Claude):** weights persist & clamp; no AI in a loop (cached); `why` never leaks secrets; RateControl doesn't block the card; `npm run verify` green.

---

## Module M-B — Reference Net + Spider · CHANGE-DETECTED + SCHEDULED

**Goal:** type a ≤100-word brief → app proposes ~20 sources → you curate → a spider re-crawls them on a cadence and flags a **"release"** only when a source actually changes.

**Data:**
- `topic_nets(id, user_id, title, brief TEXT, cadence_minutes INTEGER DEFAULT 360, last_crawled_at TEXT, created_at, updated_at)`.
- `net_sources(id, net_id, url, kind TEXT, label TEXT, trust TEXT, content_hash TEXT, last_seen_at TEXT, active INTEGER DEFAULT 1)` — `kind ∈ {rss,page,youtube,search}`.
- `net_items(id, net_id, source_id, title, url, published_at TEXT, content_hash TEXT, first_seen_at TEXT, is_release INTEGER DEFAULT 0)`.

**Service `backend/src/services/referenceNetService.js`:**
- `generateSourcesForTopic(brief)` → ~20 candidates via `generateStructuredJson` (each `{url,kind,label,why}`). **Fallback:** seed from `eventSourceMapService` lane sources + RSS/search templates derived from the brief's keywords.
- `createNet`, `listNets(userId)`, `getNet`, `curateSources(netId, accepted[])`, `addSource`, `removeSource`.
- `crawlNet(db, netId)` → for each active source, fetch via `siteMonitorService` (reuse its fetch + hashing), compute `content_hash`; if changed vs stored → insert `net_items` and set `is_release=1`. Update `last_crawled_at`.

**Worker:** extend `backend/discoveryWorker.js` to select `topic_nets` whose `last_crawled_at` is older than `cadence_minutes`, call `crawlNet`, and on any release emit through `priorityAlertStore` + `pushDeliveryService`.

**Routes `backend/src/routes/referenceNet.js` (`/api/v1/nets`)** — auth-gated: `GET /`, `POST /` `{title,brief}` (auto-generates sources), `GET /:id`, `POST /:id/sources`, `DELETE /:id/sources/:sid`, `POST /:id/crawl`, `GET /:id/items`.

**Frontend:** api.js `fetchNets, createNet, fetchNetSources, addNetSource, removeNetSource, crawlNet, fetchNetItems`. Screen `nets` (`ReferenceNetScreen`): 100-word brief box → "Generate net" → list of ~20 generated sources with keep/remove toggles + "add your own" → save → net view lists latest `net_items` with **release** items highlighted; manual "Refresh now" + cadence selector.

**Acceptance:** brief → ~20 sources → curate → items appear; a second crawl with a changed source flags `is_release=1`, an unchanged one does not; cadence configurable; AI-off still yields fallback sources.
**Test `referenceNetService.test.js`:** fallback sources non-empty with AI off; `crawlNet` flags release on hash change only; dedupe by `content_hash`.
**Reviewer checklist (Claude):** every generated source URL is real (don't fabricate); change-detection truly diffs hashes (no false "release"); worker respects cadence; no unbounded crawl; verify green.

---

## Module M-C — Interpretation + Trends & Hunts

**Goal:** read a subject through your theory lenses; surface **artist/market trends**; and flag **hunts** = high-opportunity trends/ideas/places for you as an artist.

**Lens files (Flash drafts, Claude fact-checks):** `docs/interpretation/{jung,peterson,nietzsche,jobs,mine}.md` — each: 1-paragraph lens, key concepts, and "how to read a trend/event through it." `mine.md` is Khalil's own, editable.

**Service `backend/src/services/interpretationService.js`:**
- `loadLenses()` → lens objects from the md files.
- `interpret({subject, lensKeys})` → per-lens reading via `generateStructuredJson`, each citing its lens. **Fallback:** templated framing from the lens's key concepts.
- `detectTrends(db, {domain:'art_culture'})` → cluster rising themes from `cultureService` + `art_meaning` lane + `musicStatsImportService` (your artist data) + `net_items` → `[{label, momentum, sources, why}]` (deterministic frequency×recency clustering; optional AI labeling).
- `scoreHunts(db, userId, trends)` → for each trend/idea/place compute **artist-opportunity fit** reusing the `scoreScholarshipProfileFit` pattern (profile/goal alignment × momentum × actionability) → `[{trend, opportunityScore, why, suggestedAction}]`; high score = a **hunt**.

**Routes `backend/src/routes/interpretation.js`:** `POST /api/v1/interpretation` `{subject,lenses}` → readings; `GET /api/v1/trends?domain=art_culture` → trends; `GET /api/v1/hunts` → ranked hunts.

**Frontend:** api.js `interpretSubject, fetchTrends, fetchHunts`. An "Interpretation" panel (pick lenses → readings) attachable to any figure/topic/trend; a **Trends** feed (art/market, with momentum + sources); a **Hunts** list (high-opportunity, each with *why* + a suggested action). Lives in a `culture`/`analysis` screen.

**Acceptance:** chosen lenses produce *distinct* readings that cite each lens; trends list rising art/market themes with momentum + real sources; hunts rank high-opportunity items first with a why + action; AI-off → deterministic readings/labels/scores.
**Test `interpretationService.test.js`:** lens fallback reading non-empty (AI off); trend clustering deterministic & ordered by momentum; `scoreHunts` ranks a high-fit trend above a low-fit one.
**Reviewer checklist (Claude):** lens files factually accurate (no misattribution); trends cite real sources; hunt scoring transparent & reuses the opportunity pattern (don't reinvent); no AI loop.

---

## Module M-E — Dynamic Visuals + "Final-Analysis" Synthesis

**Goal:** one surface — *"The world, in final analysis"* — that fuses the domains, ranked items, trends, hunts, and **its own gaps**, with dynamic visuals.

**Service `backend/src/services/synthesisService.js`:**
- `buildFinalAnalysis(db, userId)` → `{ headline, domains:[{lane, top:[rankedItems]}], trends, hunts, releases, gaps, generatedAt }`. Pulls lanes (`eventSourceMapService`), top items (`finalTheoryService` if present, else recency), trends+hunts (`interpretationService` if present), net releases (`referenceNetService` if present). **Each section is optional** (degrade gracefully). Optional AI synthesis of the `headline`; deterministic assembly otherwise.
- `gaps` is **first-class**: explicit list (e.g., "watches only digital sources", "N sources not yet crawled", "offline/physical blind spot", "module X not connected").

**Route `backend/src/routes/synthesis.js`:** `GET /api/v1/synthesis` → `buildFinalAnalysis`.

**Frontend:** api.js `fetchFinalAnalysis`. Screen `analysis` (`FinalAnalysisScreen`): domain sections, a **Trends** strip, a **Hunts** strip, a visible **Gaps** panel, and dynamic visuals reusing the `MiddleEastSuccessGraph` bar pattern + the map. "Dynamic" = re-renders from live data with light transitions; "Refresh" re-pulls.

**Acceptance:** one screen synthesizes domains + trends + hunts + gaps from live data; visuals scale to the data; the Gaps panel is always shown; if a module is missing its section is simply omitted (no crash).
**Test `synthesisService.test.js`:** assembles from stubbed inputs; always includes `gaps`; AI-off returns a deterministic headline; missing module → section omitted, no throw.
**Reviewer checklist (Claude):** never implies completeness (gaps always present & honest); visuals don't break with 0 or many items; no secret/PII in synthesis; verify green.

---

## Global do-not list
Don't: fabricate any source/URL · call AI without a cached deterministic fallback · add a nav screen without `ROOT_SCREENS` + `NAV_ITEMS` · store secrets · couple modules so one breaks another · ship a module without its test · claim coverage the Gaps panel contradicts.

## Final reviewer checklist (Claude, per module)
- [ ] `npm run verify` green (lint · frontend · `node --test` · build · runtime smoke)
- [ ] New `backend/test/<name>.test.js` covers the deterministic path **and** the AI-off fallback
- [ ] Every external link/source verified live (HTTP/oEmbed) before commit
- [ ] Route registered like the others + auth/allowlist correct; RLS respected
- [ ] Frontend wired in `page.js` + `AppShell.js`; data via `apiFetch`; visual rules followed
- [ ] AI cached, never looped; deterministic fallback proven
- [ ] Module is independent and degrades gracefully when others are absent
