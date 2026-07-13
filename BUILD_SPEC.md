# eXplore — Build Spec for an AI Executor (Gemini Flash) + Reviewer (Claude)

**Purpose:** This document is the single source of truth for building out eXplore toward Khalil's
full vision. It is written so a **fast-but-literal model (Gemini 3.5 Flash)** can execute one task at
a time without guessing, and so a **reviewer (Claude)** can verify each task objectively.

> Executor: do **exactly** one task at a time, in order. Do not invent architecture. Copy the
> existing pattern named in each task. Keep diffs small. After each task, run its **Acceptance**
> check and stop if it fails. Never touch secrets. Never delete existing fields or working code.

---

## 0. Golden rules (read before every task)

1. **Match existing patterns.** Every task names a "Pattern to copy" — open that file, mimic its
   shape (imports, error handling, naming, style).
2. **Small, reversible changes.** One file group per task. No mass refactors. No renaming existing
   exports.
3. **Never break what works.** Do not modify the opportunities Python pipeline, the Supabase
   messenger, or `aiService.js` key handling unless a task explicitly says so.
4. **No secrets in code, logs, UI, or commits.** Read credentials only from `process.env`. If a key
   is missing, degrade gracefully (return a clear "not configured" state), never crash.
5. **AI calls must always have a deterministic fallback.** Wrap every `aiService` call in
   `try/catch`; on failure return a sensible non-AI result. Pattern: `buildFinalInterpretation` in
   `backend/src/services/valueHierarchySync.js`.
6. **Visual rules (Khalil's design system, `rules.txt`):** neutral structure first; accent only for
   meaning — **red = danger, grey = low-priority/space, blue = trust, gold/amber = focus highlight,
   purple (`#a78bfa`) = vision/imagination**. Text must always sit inside a container. Use CSS
   tokens (`var(--surface)`, `var(--text-primary)`, `var(--border-soft)`…) — **do not** hardcode hex
   except the one semantic purple already used for "vision" surfaces.
7. **Definition of done for any task = its Acceptance block passes.** If you cannot make it pass,
   leave a `// TODO(reviewer):` note and stop.

---

## 1. Architecture cheat-sheet (the real stack)

- **Frontend:** Next.js App Router. Screens live in `src/app/components/*.js`, start with
  `'use client';`, are functional components with hooks, and self-contain styles in an inline
  `<style>{` … `}</style>` block. Data access goes through `apiFetch` from `src/app/lib/api.js`.
- **Screen routing:** `src/app/page.js` holds `const [screen, setScreen] = useState('home')` and
  renders each screen with `screen === 'x' && <XScreen .../>`. Bottom nav items are the
  `NAV_ITEMS` array in `src/app/components/AppShell.js`; top-level screens are in `ROOT_SCREENS`.
- **API helper:** `export async function fn(...) { return apiFetch('/api/v1/...', { method, body: JSON.stringify(...) }); }`
  (`src/app/lib/api.js`). `apiFetch(path, options = {})` already attaches auth + base URL.
- **Backend:** Fastify. Route modules in `backend/src/routes/*.js`:
  ```js
  module.exports = async function fooRoutes(fastify, opts) {
    const db = opts.db;
    fastify.get('/thing', async (request, reply) => { /* ... */ });
  };
  ```
  Registered in `backend/server.js`:
  ```js
  const fooRoutes = require('./src/routes/foo');
  fastify.register(fooRoutes, { prefix: '/api/v1/foo', db });
  ```
  Auth gate inside a handler: `if (!request.user?.id) return reply.status(401).send({ error: 'Authentication required.' });`
  Guest fallback (read-only state): `const userId = request.user?.id || 'guest';`
- **Services:** `backend/src/services/*.js`, `'use strict';`, use `better-sqlite3` via the passed
  `db` (`db.prepare(sql).get/all/run(...)`). Tables created with `CREATE TABLE IF NOT EXISTS`; column
  adds wrapped in `try { db.exec('ALTER TABLE ... ADD COLUMN ...'); } catch (_) {}` (see
  `valueHierarchySync.js` `ensureTables`).
- **AI:** `const aiService = require('./aiService');`
  `await aiService.generateStructuredJson({ providerPreference: 'gemini', temperature: 0.2, systemPrompt, userPrompt })`.
  Returns a parsed object. Always fallback on throw.
- **Identity/goals:** `backend/src/services/valueHierarchySync.js` — `getState(db, userId)` returns
  `{ currentGoal, coreValues[], storyHighestOrder, storyYours, storySubStories, selfRawData,
  scientificProfile, labsResearch, hasSignal, updatedAt }`.
- **News ranking:** `backend/src/services/templateRankingService.js` (`scoreRowAgainstTemplate`).
- **Opportunities:** Python in `backend/opportunities/` (`run_all.py`, `rank.py`, `matcher/`), served
  by `backend/opportunities/opportunitiesService.js` via `backend/src/routes/opportunities.js`.
- **Messaging:** Supabase (RLS) — `src/app/lib/privateMessenger.js`, migrations in
  `backend/supabase/migrations/`.
- **DB for app data:** the single `db` passed to routes (better-sqlite3). Scholarships are a separate
  SQLite file (`backend/opportunities/scholarships.db`).

**Verify commands (run from `backend/`):**
- Backend unit tests: `node --test test/<file>.test.js`
- Load a module without crashing: `node -e "require('./src/services/<x>')"`
- Python scrapers: `python run_all.py --only <name> --test` then `python rank.py`

---

## 2. Code-quality fixes (do these first — they are small and verifiable)

### CQ-1 — Flag stale job sources instead of silently reusing them
- **File:** `backend/opportunities/run_all.py`
- **Do:** In `print_summary` / after merge, compute each source file's age from its `output/<src>_jobs.json`
  mtime and print `STALE` next to sources older than 3 days. Do **not** change the merge behavior.
- **Pattern to copy:** existing `print_summary` table.
- **Acceptance:** `python run_all.py --merge-only` prints an age column and marks `remoteok`/`jobs_hu`
  as `STALE`.

### CQ-2 — Fix orphaned Chrome in browser_fetch.js
- **File:** `backend/opportunities/scrapers/browser_fetch.js`
- **Do:** Replace every `process.exit(0)` / `process.exit(2)` that sits inside the `try` with setting
  a variable `exitCode` and `return`, so the `finally { await browser.close() }` always runs; call
  `process.exit(exitCode)` once after `main()` resolves. Change `headless: 'new'` → `headless: true`.
- **Acceptance:** `node -e "require('./backend/opportunities/scrapers/browser_fetch.js')"` does not throw
  on require of puppeteer-core absence is acceptable; code review shows no `process.exit` before `finally`.

### CQ-3 — Refresh the cached scholarships DB handle
- **File:** `backend/opportunities/opportunitiesService.js` (`getScholarshipsDb`)
- **Do:** Cache the DB file mtime alongside the connection; if the file mtime changed since the cached
  connection was opened, close and reopen. Keep readonly.
- **Acceptance:** After running `refresh_official_scholarships.py`, a fresh `getScholarshipStats()` call
  in a long-lived `node` process reflects new rows (write a 10-line throwaway script to prove it, then
  delete it).

### CQ-4 — Per-tenant guest isolation note
- **File:** `backend/src/routes/hierarchy.js`
- **Do:** Add a code comment at `resolveUserId` documenting that all unauthenticated users collapse to
  `'guest'` and therefore **share** one hierarchy row; do **not** change behavior (single-user app today).
  This is a guardrail note for the reviewer, not a refactor.
- **Acceptance:** Comment present; no behavior change.

### CQ-5 — Scorer breakdown honesty
- **File:** `backend/opportunities/matcher/scorer.py`
- **Do:** Where the code does `points = min(points - pts, CAP)`, change the breakdown label from a bare
  `"-28"` to `"cap≤55 (-28)"` style so the transparency string matches the real effect. Logic unchanged.
- **Acceptance:** `python -c "from matcher.scorer import score"` imports clean; labels reflect caps.

### CQ-6 — Visual token drift (HomeScreen, OpportunitiesScreen)
- **Files:** `src/app/components/HomeScreen.js`, `src/app/components/OpportunitiesScreen.js`
- **Do:** Replace hardcoded hex colors with existing CSS tokens from `src/app/globals.css` **only where a
  token clearly exists** (e.g. `#34d399`→`var(--success)`, greys→`var(--text-secondary)`/`--border-soft`).
  Keep the semantic purple `#a78bfa` for "vision" badges. Do not change layout.
- **Acceptance:** `grep -c '#[0-9a-fA-F]\{6\}' <file>` drops; screens still reference the same semantic colors.

### CQ-7 — melodiak pagination (optional, low priority)
- **File:** `backend/opportunities/scrapers/melodiak.py`
- **Do:** If `melodiak.hu/diakmunkak?page=N` exists, loop pages until a page yields 0 `.job-list-item`
  cards (cap 10 pages). If pagination isn't supported, leave a `# single-page only` comment.
- **Acceptance:** `python -m scrapers.melodiak` still returns ≥1 job and does not error.

---

## 3. Feature modules (Khalil's vision → concrete tasks)

> Build modules in this order: **M-A → M-F → M-B → M-C → M-D → M-G → M-E → M-H → M-I**.
> Each module is independent; finish and verify one before starting the next.

### MODULE A — Mail + Notification Intelligence (Build-Order Phase 1, highest value)

**Goal:** Connect Gmail (read-only), detect important mail, summarize, categorize by life domain,
extract deadlines + required actions, draft replies, alert only when needed.

**Pre-req (human, not executor):** Provide `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI` in `backend/.env`. If absent, every endpoint must return
`{ configured: false }` and the UI shows a "Connect Gmail (not configured)" state.

- **A-1 — Schema.** New service `backend/src/services/mailIntelligenceService.js`.
  - `ensureTables(db)` creates:
    - `mail_accounts(id TEXT PK, user_id TEXT, provider TEXT, email TEXT, access_token TEXT,
      refresh_token TEXT, token_expiry TEXT, created_at, updated_at)`
    - `mail_messages(id TEXT PK, user_id TEXT, account_id TEXT, gmail_id TEXT UNIQUE, sender TEXT,
      subject TEXT, snippet TEXT, received_at TEXT, life_domain TEXT, importance TEXT, summary TEXT,
      deadline TEXT, action TEXT, draft_reply TEXT, is_emergency INTEGER DEFAULT 0,
      processed_at TEXT, raw_excerpt TEXT)`
    - `mail_reference_senders(id TEXT PK, user_id TEXT, email TEXT, label TEXT)` (the "5 important emails").
  - Pattern to copy: `ensureTables`/`upsertState` in `valueHierarchySync.js`.
  - **Acceptance:** `node -e "const s=require('./src/services/mailIntelligenceService'); const D=require('better-sqlite3'); s.ensureTables(new D(':memory:')); console.log('ok')"` prints `ok`.

- **A-2 — OAuth connect/callback routes.** New `backend/src/routes/mail.js`, registered as
  `/api/v1/mail` in `server.js` (copy the hierarchy registration lines).
  - `GET /auth-url` → `{ configured, url }` (Google OAuth consent URL, scope
    `https://www.googleapis.com/auth/gmail.readonly`). Use `googleapis` npm if present; else build the
    URL by string template (no secret in URL except client_id which is public).
  - `GET /callback?code=...` → exchanges code for tokens (server-side, uses client secret from env),
    stores in `mail_accounts`, redirects to the app.
  - All handlers: if env missing → `{ configured: false }`, status 200.
  - **Acceptance:** With no env set, `GET /api/v1/mail/auth-url` returns `{ configured: false }`.

- **A-3 — Fetch + classify.** In `mailIntelligenceService.js`:
  - `async function syncMail(db, userId)`: pull last 30 messages via Gmail API, upsert into
    `mail_messages` (dedupe on `gmail_id`).
  - `async function classifyMessage(db, message)`: call `aiService.generateStructuredJson` with a
    system prompt that returns JSON
    `{ life_domain, importance: "emergency|today|week|opportunity|archive|ignore", summary,
    deadline, action, draft_reply, is_emergency }`. **Deterministic fallback** on throw: keyword rules
    (subject contains "invoice|bill|payment"→money; "deadline|due"→extract; default importance "week").
  - `life_domain` ∈ {University, Work, Scholarship, Visa/Documents, Money, Family, Housing, Health,
    Urgent, Creative/SPHERE}.
  - **Acceptance:** Unit test `backend/test/mailIntelligence.test.js` (node:test) feeds a fake message
    through the deterministic fallback and asserts a valid `life_domain` + `importance`.

- **A-4 — Read endpoints.** In `mail.js`:
  - `POST /sync` (auth) → runs `syncMail`+classify, returns counts.
  - `GET /messages?domain=&importance=` (auth) → grouped list.
  - `GET /reference-senders` / `POST /reference-senders` → manage the 5 priority senders.
  - **Acceptance:** Routes load (`node -e "require('./src/routes/mail')"`), return 401 without auth.

- **A-5 — UI screen.** New `src/app/components/MailIntelligenceScreen.js` + api helpers in
  `src/app/lib/api.js` (`fetchMailAuthUrl`, `syncMail`, `fetchMailMessages`, `fetchReferenceSenders`,
  `addReferenceSender`). Wire into `src/app/page.js` (`screen === 'mail' && <MailIntelligenceScreen/>`)
  and add a nav entry or a card link from the "You"/Feed screen.
  - Layout: a 6-tier importance column view (Emergency → Today → This week → Opportunity → Archive →
    Ignore), each message card shows domain chip, summary, deadline, action, and a "Draft reply" reveal.
  - Follow visual rules; copy card styling from `OpportunitiesScreen.js`.
  - **Acceptance:** With backend down, screen shows an error state, not a crash; with `{configured:false}`
    it shows the connect-not-configured state.

### MODULE F — Emergency + Life-Domain Message Filter

**Goal:** Order ALL signals (mail + app messages + alerts) into 6 buckets by life domain + urgency.

- **F-1 — Domain classifier (shared).** Add `classifyLifeDomain(text)` to
  `backend/src/services/mailIntelligenceService.js` (or a new `lifeDomainService.js`) — deterministic
  keyword map to {Money, Work, Study, Family, Housing, Health, Documents, Legal/Visa, Creative,
  Relationships, SPHERE, Long-term}. Reuse from A-3.
- **F-2 — Unified priority feed endpoint.** `GET /api/v1/mail/priority-feed` returns all
  `mail_messages` + (optionally) alert items ordered into the 6 tiers. **Acceptance:** returns tiers
  array even when empty.
- **F-3 — UI.** Reuse the MailIntelligenceScreen 6-tier view; add a top "Today's true 20%" strip that
  shows only `emergency` + `today` items (the "20% path" idea). **Acceptance:** strip renders the
  highest-urgency items only.

### MODULE B — Simple Profile Modifier (profile variants)

**Goal:** One living profile that generates tailored versions (scholarship / job / study / project).

- **B-1 — Service + schema.** `backend/src/services/profileVariantService.js`:
  `profile_variants(id, user_id, kind, title, body_json, updated_at)`. `getVariants(db,userId)`,
  `generateVariant(db,userId,kind)` — uses `getState` (hierarchy) + `aiService` to produce a tailored
  profile JSON `{ summary, skills[], highlights[], tailoredFor }`; deterministic fallback builds it from
  `coreValues` + `currentGoal`.
- **B-2 — Routes** `/api/v1/profile-variants` (GET list, POST generate, POST save). Auth-gated.
- **B-3 — UI** card in `PreferencesScreen.js` ("Profile versions") listing variants with a
  Generate/Refresh button per kind. Copy the Labs-research card pattern in `OpportunitiesScreen.js`.
- **Acceptance:** Generating a "scholarship" variant returns a JSON body; fallback works with no AI keys.

### MODULE C — Reference Site Monitoring (G2G + custom sites)

**Goal:** Watch user-added sites, detect relevant changes, rank by fit, alert only if important.

- **C-1 — Schema/service** `backend/src/services/siteMonitorService.js`:
  `monitored_sites(id, user_id, url, label, last_hash, last_checked_at, last_change_at)`,
  `site_findings(id, site_id, user_id, title, url, summary, fit_score, found_at)`.
- **C-2 — Checker** `async function checkSite(db, site)`: fetch URL (reuse a node fetch with a browser
  UA), hash the main text, if changed extract candidate links (copy `is_candidate_link` heuristic from
  `backend/opportunities/refresh_official_scholarships.py`), score fit with `computeHierarchyAlignment`.
- **C-3 — Routes** `/api/v1/sites` (CRUD + `POST /check-all`). **C-4 — UI** extend
  `src/app/components/SourcesScreen.js` with an "Add site to monitor" form + findings list.
- **Acceptance:** Adding a URL then `POST /check-all` stores a finding row or a "no change" result.

### MODULE D — News Filter "important paths" presets

**Goal:** Preset the news filter with Khalil's country/topic paths (Hungary, Jordan, USA, Europe, AI,
Scholarships, Immigration, Work law, University deadlines, War/danger, Economy, Tech).

- **D-1 — Seed presets** as a constant `LIFE_NEWS_PATHS` in
  `backend/src/services/templateRankingService.js` (or a new `newsPathsService.js`) and expose
  `GET /api/v1/template/news-paths`. Do **not** change the existing scoring formula — just add these as
  selectable adaptive rules.
- **D-2 — UI** in `TemplateScreen.js`: a checklist of the preset paths the user can toggle on; toggling
  adds/removes the matching rule via the existing template rule API.
- **Acceptance:** Toggling "Jordan" adds a rule that visibly affects `templateRankingService` matching
  (covered by a small node test using `computeRuleMatches`).

### MODULE G — Average vs Edge mode

**Goal:** A global toggle. Average = life-work balance surfacing; Edge = SPHERE resource gathering.

- **G-1 — Store** the mode on the hierarchy (`upsertState` add `app_mode` column via the ALTER pattern;
  values `'average' | 'edge'`). `GET/POST /api/v1/hierarchy/mode`.
- **G-2 — Effect:** when `edge`, `buildFinalInterpretation` and `templateRankingService` weight
  vision/SPHERE/creative/research higher; when `average`, weight daily-life/work/deadlines higher. Add a
  single multiplier, do not rewrite the formula.
- **G-3 — UI** a segmented toggle in `PreferencesScreen.js` header.
- **Acceptance:** Switching modes changes the Final Interpretation `amplify` ordering (node test).

### MODULE E — Opportunities voice flow ("find me work")

**Goal:** Speak a request; app searches, ranks, explains, prepares action.

- **E-1 — Frontend only.** Add a mic button to `OpportunitiesScreen.js` using the browser
  `webkitSpeechRecognition` (guard for unsupported browsers → hide button). Map phrases:
  "find me work"→jobs tab + sweep, "find me scholarships"→scholarships tab, "what should I apply for"→
  top-10 fast track. No backend change.
- **Acceptance:** In a supporting browser, speaking "find me scholarships" switches to the scholarships
  tab; in an unsupported browser the button is hidden (no crash).

### MODULE H — Formulation Tool (Heart → Golden)

**Goal:** Turn raw inner experience (feelings, writings, dreams) into a clear golden formulation.

- **H-1 — Service** `backend/src/services/formulationService.js`:
  `formulations(id, user_id, input_text, output_json, created_at)`. `async function formulate(db,
  userId, inputText)` → `aiService.generateStructuredJson` returning
  `{ themes[], lifeDomains[], goalLinks[], actions[], goldenParagraph, draftEssay }`; deterministic
  fallback = extract top tokens + a templated paragraph.
- **H-2 — Route** `POST /api/v1/formulation` (auth) + `GET /api/v1/formulation` (history).
- **H-3 — UI** new `src/app/components/FormulationScreen.js` (textarea in → golden output card),
  wired in `page.js` and reachable from "You".
- **Acceptance:** Submitting text returns a `goldenParagraph` (AI or fallback); history lists past runs.

### MODULE I — X-Suite scaffolding (eXperience, eXperiment)

**Goal:** Reserve the structure: eXplore (world) / eXperience (self) / eXperiment (action).

- **I-1 — Minimal eXperience** = reuse Formulation (H) + a simple journal table
  `experience_entries(id, user_id, kind, body, created_at)` with CRUD `/api/v1/experience` and a basic
  list UI. **I-2 — Minimal eXperiment** = a "tracked attempts" table
  `experiments(id, user_id, hypothesis, action, status, result, created_at)` with CRUD
  `/api/v1/experiment` and a checklist UI. Keep both intentionally simple.
- **Acceptance:** Both endpoints CRUD a row; both screens render an empty + populated state.

---

## 4. Global verification (reviewer + executor)

Run after each module:
- `cd backend && node --test test/` (all backend tests pass)
- `node -e "require('./backend/server.js')"` must not throw on route registration (or start the server
  and hit the new endpoints with curl).
- New Python: `cd backend/opportunities && python run_all.py --only melodiak --test && python rank.py`.
- Frontend: there is **no local build here** (thin checkout — `react`/`next` not installed). The
  reviewer validates components by reading + (if a full stack is available) running `npm run dev` via
  `scripts/run-local-stack.ps1` and clicking the new screen.
- **Every new endpoint:** returns 401 without auth (if it writes user data), returns a graceful
  `{ configured:false }`/empty state when its dependency (Gmail/AI keys) is missing, and never logs a
  secret.

---

## 5. Do-NOT list (hard stops for the executor)

- ❌ Do not modify `aiService.js` key rotation/loading, the Supabase messenger, or
  `backend/opportunities/*.py` scoring logic unless a task says so.
- ❌ Do not print, return, or commit any API key, token, or secret.
- ❌ Do not remove existing DB columns, exports, routes, or UI fields.
- ❌ Do not hardcode colors except the established purple `#a78bfa` for "vision" surfaces.
- ❌ Do not add new heavy dependencies without noting them; prefer Node/Python stdlib + already-installed
  packages (`better-sqlite3`, `fastify`, existing `googleapis` if present).
- ❌ Do not "fix" or rewrite files outside the current task's named files.

---

## 6. Reviewer (Claude) checklist per task

For each task Gemini completes, the reviewer confirms: (1) only the named files changed; (2) the pattern
was followed; (3) Acceptance passes; (4) AI calls have fallbacks; (5) no secret leakage; (6) visual rules
respected; (7) errors are handled, not swallowed silently. Anything failing → reject with the specific
file:line and the rule it broke.
