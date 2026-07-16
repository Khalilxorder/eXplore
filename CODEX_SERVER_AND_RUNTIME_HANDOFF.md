# eXplore — Codex handoff: servers, APIs, messaging, Gemini keys, full function proof

**Date:** 2026-07-15  
**Workspace:** `C:\Users\khali\Desktop\eXPLORE`  
**GitHub:** https://github.com/Khalilxorder/eXplore  
**Local git:** `main` is **2 commits ahead** of `origin/main` (not pushed yet)

| Commit | Summary |
|--------|---------|
| `b2f807f3` | Feed reliability finalize (72h news, Gemini failover, verify pipeline) |
| `bfd6f3b6` | Opportunities miss-nothing coverage + personal fit ranking |

**Product goal:** Life Directed Intelligence — news, radar, opportunities, messages, YouTube, AI analysis on one spine.  
**Brand:** `eXplore` (lowercase e, uppercase X).

You own **server-side, live APIs, messaging production proof, Gemini pool health, and making sure every important function actually works end-to-end**. Local automated verify is already green for code; live/provider/device gates are your focus.

---

## 0) Non-negotiable rules

1. **Do not rebuild the app.** Extend what exists. No duplicate screens, no second messenger, no second AI stack.
2. **Secrets:** read from machine config first — never paste keys into chat, docs, or git.
   ```powershell
   cd C:\Users\khali\Desktop\eXPLORE
   npm run config:sync
   ```
   - Machine config: `C:\Users\khali\.dev-config\services.json` → `projects.explore`
   - Gemini pool file (optional): `C:\Users\khali\.dev-config\gemini-key-pool.json`
   - Project files written: `.env.local`, `backend/.env`, `android/app/google-services.json` when present
3. **Proof > claims.** A route existing is not proof. Use tests + live probes + readiness endpoints.
4. **Do not commit secrets, logs, APKs, or `*(1)*` duplicate files.**
5. Prefer honest degraded behavior over fake “success” when providers fail.

---

## 1) What is already done (do not re-litigate)

### Local verification (2026-07-15)

Full pipeline `npm run verify` was green after finalize:

| Gate | Result |
|------|--------|
| ESLint | 0 errors |
| Frontend static verifiers | pass |
| Backend tests | **244/244** (then opportunities tests expanded) |
| Production build | pass (`explore-20260715200106-ededbd6a`) |
| Android web asset sync | same build id |
| News-page (72h cap) | pass |
| Runtime smoke | pass (anonymous auth reject + official-releases) |
| Release-contract | pass |

### Product code already landed

- Intelligence spine (theory, topics, Source Web, explanations, cycle APIs)
- News 72h visibility + discovery candidate age cap
- Gemini multi-key rotation, timeouts, disabled-key cool-down, model alias → `gemini-3.5-flash`
- Opportunities **miss-nothing** pool (`score >= 50`), `GET /jobs/search`, registry expansion
- Private messenger **schema + UI + readiness services + migrations** (not fully live-proven on two devices)
- Capacitor Android shell + radar worker

### Explicit external gates left for you (Codex)

1. Hosted **Supabase** apply of migrations + realtime + storage  
2. **Private messaging E2E** two real users / two devices  
3. **Gemini pool live** (all configured keys, flash 3.5)  
4. **FCM / push** on physical Android  
5. **Google sign-in** live if enabled  
6. Production **DATA_BACKEND** strategy (today local is SQLite)  
7. Push local commits to GitHub if user wants public parity  
8. Optional: Wellfound job scraper (only remaining critical job source gap)

---

## 2) Architecture map (what you must keep working)

| Layer | Implementation |
|-------|----------------|
| Web UI | Next.js 16 App Router — `src/app` |
| API | Fastify 5 — `backend/server.js` + `backend/src/routes/*` |
| Local data | SQLite `better-sqlite3` (`DATA_BACKEND=sqlite`) |
| Production data target | Supabase Postgres + RLS migrations in `backend/supabase/migrations/` |
| Auth | Supabase Auth bearer tokens |
| AI | Gemini via `backend/services/aiService.js` (default model **gemini-3.5-flash**) |
| Key pool | Up to **100** slots: `GOOGLE_AI_API_KEY_1..100` / pool JSON file |
| Push | Firebase FCM + Capacitor; private-message push channel |
| Messaging | Supabase tables + RLS + realtime; UI `MessagingHubScreen.js` / `privateMessenger.js` |
| Opportunities | Python scrapers + ranker under `backend/opportunities/` |
| Workers | `backend/pushWorker.js`, `backend/discoveryWorker.js` |

### Important paths

```
backend/server.js                          # main API
backend/services/aiService.js              # Gemini pool + flash 3.5
backend/src/services/privateMessagingReadinessService.js
backend/src/services/privateMessengerNotificationService.js
backend/src/services/pushDeliveryService.js
backend/src/services/readinessService.js
src/app/lib/privateMessenger.js
src/app/components/MessagingHubScreen.js
src/app/components/AiChatPanel.js
backend/supabase/migrations/20260531_private_messenger.sql
backend/supabase/migrations/20260601_private_messenger_*.sql
backend/supabase/migrations/20260713_intelligence_spine.sql
scripts/sync-machine-config.ps1
scripts/run-verify.mjs
```

---

## 3) Gemini 3.5 Flash + multi-key pool (must work)

### How the code loads keys (`backend/services/aiService.js`)

- **Max slots:** 100 (`MAX_GEMINI_KEY_SLOTS = 100`)
- **Default model:** `gemini-3.5-flash` (aliases like `gemini-2.5-flash-lite` normalize to 3.5 flash)
- **Sources (merged, de-duped):**
  1. `GOOGLE_AI_API_KEY` / `GOOGLE_GEMINI_API_KEY` / `GEMINI_API_KEY`
  2. Comma/newline list `GOOGLE_AI_API_KEYS`
  3. Indexed `GOOGLE_AI_API_KEY_1` … `_100` (also `GEMINI_API_KEY_N`, `GOOGLE_GEMINI_API_KEY_N`)
  4. JSON pool file `GEMINI_KEY_POOL_FILE` or `~/.dev-config/gemini-key-pool.json`
- **Runtime behavior:**
  - Round-robin / least-in-flight selection
  - Per-request tries up to `GEMINI_MAX_KEYS_PER_REQUEST` (default 3)
  - Cool-down on 401/403 (24h), 429/5xx
  - Request timeout (default 15s) then rotate
  - Safe diagnostics never log raw keys

### Current machine state (2026-07-15 snapshot — do not print keys)

| Item | Observed |
|------|----------|
| `AI_PROVIDER` | `gemini` |
| Models | `GEMINI_MODEL` / `ANALYSIS` / `TEMPLATE` = **gemini-3.5-flash** |
| Numbered live-looking slots in machine config | **10** (not 100 filled) |
| Pool file keys | **10** |
| `backend/.env` numbered slots after sync | **10** |
| `OPENAI_API_KEY` | missing (no OpenAI fallback) |
| `ALLOW_DEV_MOCKS` | `false` in backend `.env` |

**Implication:** App supports 100 keys; this machine currently has **~10 live Gemini keys**. If the user expects 100, **load the remaining keys into machine config / pool file**, then `npm run config:sync`. Do not invent keys.

### Codex checklist — AI pool

1. `npm run config:sync`
2. Confirm models are `gemini-3.5-flash` (not stale 2.5 aliases)
3. Count live keys without printing them (use readiness / pool diagnostics endpoint if present)
4. Run backend tests:
   ```powershell
   npm run test:backend
   ```
   Especially: `aiServicePool.test.js`, `aiService.test.js`
5. Live probe (real network):
   - Hit analysis/chat path with backend running
   - Force one bad key cool-down and prove failover to next key
   - Confirm chat UI (`AiChatPanel`) returns real text, not “No response”
6. If user provides more keys: add as `GOOGLE_AI_API_KEY_11` … or update `gemini-key-pool.json`, re-sync
7. Document final **count of healthy keys** and any permanently suspended (401/403) keys without revealing secrets

### Related env (keep set)

```
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-3.5-flash
GEMINI_ANALYSIS_MODEL=gemini-3.5-flash
GEMINI_TEMPLATE_MODEL=gemini-3.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_KEY_POOL_FILE=C:\Users\khali\.dev-config\gemini-key-pool.json
GEMINI_MAX_KEYS_PER_REQUEST=3
GEMINI_REQUEST_TIMEOUT_MS=15000
```

---

## 4) Messaging (private Telegram-like chat) — must work

### What exists

- **UI:** Messages tab → `MessagingHubScreen.js` (private + Meta/Gmail hub shell)
- **Client:** `src/app/lib/privateMessenger.js` (Supabase client, realtime, send/read)
- **Migrations (must be applied on hosted Supabase):**
  - `20260531_private_messenger.sql` — profiles, conversations, messages, read receipts, RLS, realtime
  - `20260601_private_messenger_attachments.sql` — storage bucket `private-chat-files`
  - `20260601_private_messenger_message_actions.sql` — reply/edit/delete
  - `20260601_private_messenger_typing_status.sql`
  - `20260601_private_messenger_conversation_preferences.sql`
  - `20260601_private_messenger_least_privilege.sql`
- **Backend readiness:** `GET /api/v1/messages/readiness`
- **Push:** private-message notification path + FCM when configured
- **Tests:**  
  `privateMessagingReadinessService.test.js`,  
  `privateMessagingSqliteSchema.test.js`,  
  `privateMessengerMigration.test.js`,  
  `privateMessengerNotificationService.test.js`,  
  frontend `verify-private-messaging-ui.mjs`

### Required tables (readiness expects)

`private_chat_profiles`, `private_conversations`, `private_messages`, `private_read_receipts`, `private_typing_status`, `private_conversation_preferences`

### Codex checklist — messaging E2E

1. Confirm Supabase project has **all messenger migrations applied** (not just local files)
2. Confirm RLS: user A cannot read user B’s conversations
3. Confirm **Realtime** publication includes `private_messages` and typing
4. Confirm storage policies for `private-chat-files`
5. Two accounts on two browsers/devices:
   - create conversation  
   - send text  
   - receive realtime  
   - read receipt  
   - optional attachment  
   - optional push when app backgrounded  
6. Hit `GET /api/v1/messages/readiness` — all critical checks green  
7. Meta/Gmail hubs: capability-aware only; **do not fake** send if OAuth missing  
8. Fix any “signed-in required” dead ends in UI with clear errors

### Known honesty limits

- Messaging is **Supabase-backed**, not SQLite-local for real chat history  
- Local `DATA_BACKEND=sqlite` does **not** replace hosted private chat  
- Until migrations + auth are live, two-phone chat is **unproven**

---

## 5) Servers, APIs, workers — must work

### Start stack

```powershell
cd C:\Users\khali\Desktop\eXPLORE
npm run config:sync
npm run dev:stack
# Frontend: http://localhost:3000
# Backend:  http://localhost:8080
```

Or separately:

```powershell
# terminal 1
cd backend
npm run dev

# terminal 2
cd C:\Users\khali\Desktop\eXPLORE
npm run dev:web
```

### Workers (production-ish)

```powershell
cd backend
npm run worker:alerts
npm run worker:discovery
```

Docker: `docker compose up --build` (frontend `out/` + API + workers).

### Critical API surfaces to prove

| Area | Examples |
|------|----------|
| Health / readiness | `/api/v1/health`, `/api/v1/readiness`, `/api/v1/messages/readiness` |
| Auth | bearer required on protected routes; anonymous → 401 |
| News / feed / discovery | feed, sources status, discovery refresh |
| Radar / alerts | official-releases, priority alerts |
| Intelligence | theory, topics, source-web, cycle run/status |
| AI chat | chat/analyze paths using Gemini pool |
| Opportunities | `/api/v1/opportunities/jobs`, `/jobs/search`, `/scholarships`, `/coverage` |
| Devices / push | device register, notification-status (needs bearer) |
| Hierarchy / profile | story layers, preferences |

### Current env truth

| Setting | Local now |
|---------|-----------|
| `DATA_BACKEND` | **sqlite** |
| Supabase URL/keys | present in machine config |
| Firebase project | present |
| YouTube | present |
| OpenAI fallback | **missing** |
| Google OAuth | verify live provider probe — historically flaky |

### Codex checklist — server

1. `npm run config:sync` then inspect **non-secret** readiness JSON  
2. Backend starts without crash; health 200  
3. Full:
   ```powershell
   npm run verify
   ```
4. Optional live product:
   ```powershell
   npm run verify:product
   npm run test:live-messaging
   ```
5. For production host: set `DATA_BACKEND=postgres` (or project’s production mode) **only after** migrations applied  
6. Apply migrations: ideal_state + private messenger set + intelligence_spine  
7. Ensure Redis optional: offline must degrade, not hang (already patched once)  
8. Schedule discovery + alert workers if deploying long-running server  

---

## 6) Opportunities / “miss nothing” (code ready; refresh is ops)

Already implemented in commits above:

- High-fit pool score ≥ 50 → `ranked/miss_nothing.json` + API `recommended` / `miss_nothing`
- Search: `GET /api/v1/opportunities/jobs/search?q=...`
- Psychology/research/student scoring boosts
- Coverage report: only **wellfound** left as critical missing scraper

### Codex / ops refresh

```powershell
cd backend\opportunities
python run_all.py --all-available
python rank.py --top 25
# or API:
# POST /api/v1/opportunities/jobs/sweep
```

Scholarships:

```powershell
cd backend
npm run scholarships:official
```

Keep profile lens: `backend/opportunities/user_profile.json` (Khalil / Budapest / SPHERE / psych+AI).

---

## 7) Full function proof matrix (do this end-to-end)

Run and record pass/fail with evidence:

### A. Automated (local)

```powershell
cd C:\Users\khali\Desktop\eXPLORE
npm run config:sync
npm run verify
```

### B. Live AI

- [ ] AI chat returns Gemini 3.5 flash answer  
- [ ] Key failover works if first key cools  
- [ ] Analysis on a news/radar item works  
- [ ] Embeddings path does not crash without OpenAI  

### C. Messaging

- [ ] Two users create chat  
- [ ] Realtime delivery  
- [ ] Read receipts  
- [ ] Attachment upload (if storage ready)  
- [ ] Push notification (if FCM ready)  
- [ ] `/api/v1/messages/readiness` all green  

### D. Auth / device

- [ ] Sign-up / sign-in (email or Google if enabled)  
- [ ] Protected routes reject anonymous  
- [ ] Device token registration  
- [ ] Notification-status with bearer  

### E. Feed / opportunities

- [ ] Home news not empty; items ≤ 72h  
- [ ] Priority radar loads  
- [ ] Jobs `miss_nothing` / search returns high-fit  
- [ ] Scholarships search ranks profile fit  

### F. Android (if in scope)

- [ ] `npm run build` + `npx cap copy android`  
- [ ] Install debug/release APK  
- [ ] Push + deep link on physical device  

---

## 8) Definition of done (for Codex)

You may claim **server+functions done** only when:

1. `npm run verify` still green after your changes  
2. Live Gemini pool: ≥ configured keys healthy, model **gemini-3.5-flash**, chat works  
3. Messaging readiness green **and** two-user E2E chat proven  
4. Core APIs (health, readiness, feed, radar, opportunities, intelligence) respond correctly  
5. No secrets committed; no fake “live” when provider is down  
6. Short written proof log (commands + results, no keys)

---

## 9) Suggested Codex execution order

1. `git status` / pull or continue from local `main` (2 commits ahead of GitHub — push if user wants)  
2. `npm run config:sync`  
3. Inventory Gemini key count (target: load all user-provided keys up to 100)  
4. Start backend + prove AI chat + pool failover  
5. Apply Supabase messenger + intelligence migrations on hosted project  
6. Prove private messaging E2E  
7. Prove readiness endpoints + push path  
8. Refresh opportunities scrapes if data stale  
9. Re-run `npm run verify`  
10. Hand back proof matrix  

---

## 10) Copy-paste master prompt for Codex

```text
You are working in C:\Users\khali\Desktop\eXPLORE (GitHub: Khalilxorder/eXplore).

Do NOT rebuild. Local verify was green after commits:
- b2f807f3 feed reliability finalize
- bfd6f3b6 opportunities miss-nothing

Your job: make SERVER, APIs, MESSAGING, and GEMINI multi-key flash 3.5 pool fully work in reality.

Rules:
1. npm run config:sync first. Secrets live in C:\Users\khali\.dev-config\services.json and gemini-key-pool.json.
2. Never print API keys. App supports up to 100 Gemini keys; machine currently has ~10 live — load more if user provides them.
3. Default model must be gemini-3.5-flash (see backend/services/aiService.js).
4. Private messaging is Supabase RLS + realtime (migrations 20260531 + 20260601_*). Prove two-user E2E, not just UI.
5. DATA_BACKEND is sqlite locally; production needs hosted Supabase migrations applied.
6. Keep miss-nothing opportunities behavior; refresh scrapers if stale.
7. Finish with npm run verify green + a proof matrix for AI pool, messaging, auth, feed, opportunities, push.

Read and follow: CODEX_SERVER_AND_RUNTIME_HANDOFF.md
Also useful: AGENTS.md, IMPLEMENTATION_STATUS.md, docs/eXplore Repository Truth Map 2026-07-13.md

Start now: config sync → backend health → Gemini pool live probe → messages readiness → E2E chat → full verify.
```

---

## 11) User note (for you, Khalil)

Give Codex this file path:

`C:\Users\khali\Desktop\eXPLORE\CODEX_SERVER_AND_RUNTIME_HANDOFF.md`

Or paste **section 10**.

If you have **more than 10 Gemini keys** (up to 100), put them in machine config / pool file **before** Codex starts so they can sync and prove the full pool.

I did **not** push to GitHub; say if you want that first so Codex and GitHub match.
