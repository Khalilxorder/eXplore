# eXplore Repository Truth Map — 2026-07-13

This is a current-checkout audit. It separates source evidence, local runtime evidence, and provider/device proof. Archived handoff reports are treated as historical context, not as current verification.

## Verification result

`npm run verify` passes in the current checkout:

- ESLint: 0 errors, 192 warnings. Generated output and browser artifacts are excluded by `eslint.config.mjs`; the remaining source JSX error in `UnifiedInboxScreen.js` was corrected.
- Frontend verifiers: runtime guard, event priority, reference box, video library, and private messaging all pass.
- Backend tests: 205/205 pass through `scripts/run-backend-tests.mjs`.
- Next build: passes and generates static output with build metadata `explore-20260713093638-879a2af5`.
- News-page verifier: 9 tabs, 17 snapshot items, event cards, images, metrics, refresh sequencing, priority levels, and scientist direct-open all pass.
- Runtime smoke: health, source status, anonymous protected-route rejection, official releases, and static output pass. The protected notification-status check was skipped because no bearer token was supplied.

The backend test wrapper deliberately blanks live provider keys and uses a test-only missing Gemini pool file. Passing tests therefore prove deterministic application behavior, not live AI/provider availability.

## Repairs made during this audit

- Fixed the real lint failure in `src/app/components/UnifiedInboxScreen.js` by escaping rendered ampersands.
- Added `scripts/run-backend-tests.mjs` and changed `package.json` so backend tests cannot accidentally load the shared machine Gemini pool or hang on live provider work.
- Bounded the Redis queue enqueue in `backend/src/routes/intelligence.js`; when Redis is offline, it now closes the retrying connection and falls back without leaking a pending process.
- Made the intelligence route test deterministic by stubbing the YouTube adapter in the fallback case and closing Fastify before the database teardown.

## Architecture truth map

| Spine layer | Current evidence | Truth status |
| --- | --- | --- |
| User Theory | `intelligence` routes/services persist interests, goals, memories, preference profiles, interaction events, corrections, and feedback. | Implemented locally; hosted parity and end-to-end learning proof are incomplete. |
| Three Story Layers | `valueHierarchySync.js` stores Life Narrative, Future Wish, and Current Goals; `/api/v1/hierarchy/story-alignment` computes deterministic overlap/alignment. | Implemented locally; broad frontend explanation coverage is not proven. |
| Topics | `topics`, `interests`, `user_interests`, goals, topic monitors, and onboarding topic/goal normalization exist. | Implemented in multiple overlapping representations; contract consolidation is needed. |
| Source Web | Sources, source packs, YouTube channels/queries/monitors, source health, official release-watch sources, and Jordan/risk lanes exist. | Implemented as a configured source system; freshness and external-source success still require live probes. |
| Content and Events | Content items, chunks, sources, embeddings, interaction events, feed candidates, written news, YouTube ingestion, and anomaly feeds exist. | Implemented locally with provider fallbacks. |
| Ranking | `recommenderCore`, `templateRankingService`, story alignment, source trust, and AI analysis feed ranking. | Implemented locally; fallback ranking is used when embeddings/reranking/AI are unavailable. |
| Analysis | Gemini/OpenAI routing, deterministic analysis, transcript/description fallback, and written-brief fallback exist. | Provider-backed path is conditional; fallback paths are real and can be used without live AI. |
| Notifications | Radar alerts, official release alerts, notification preferences, device tokens, FCM service code, and local fallback exist. | Web/backend foundations pass; physical Android push/deep-link delivery is unproven. |
| Messages | Private messenger, Meta inbox routes, Gmail routes, and the three-tab shell (`Feed`, `Messages`, `You`) exist. | Multiple message systems are present; one fully proven unified external hub is not established. |
| Feedback | Event batch, save/like/hide/dislike, ratings, written corrections, memory proposals, and preference updates exist. | Capture exists; measurable downstream ranking improvement is not proven. |

## Integration and environment status

`npm run config:sync` passed. The repository instruction’s Administrator path (`C:\Users\Administrator\.dev-config\services.json`) was not present on this machine; the sync script used the current-user machine config at `C:\Users\khali\.dev-config\services.json` and populated the project files.

Current non-secret status checks show:

- Frontend Supabase URL and public key: present.
- Backend Supabase URL, anon key, service key, and access token: present.
- Gemini credentials/model configuration: present; `AI_PROVIDER=gemini` and `ALLOW_DEV_MOCKS=false`.
- YouTube credentials: present.
- Firebase project/service-account configuration and `android/app/google-services.json`: present.
- Google OAuth credentials for Gmail: present.
- Apify credentials: present.
- OpenAI fallback key: missing.
- Meta app ID, app secret, and login-config ID: missing; Meta inbox cannot be called production-ready.
- PostgreSQL URL: missing; current runtime is `DATA_BACKEND=sqlite`.
- Redis URL is configured, but the backend test run observed Redis connection refusal; the ingestion route now degrades safely.

Credential presence is not credential validity. No live provider probe, OAuth completion, Supabase migration deployment check, or physical Android delivery check was treated as passed by this audit.

## Schema and migration truth

SQLite contains a wider local schema than the checked-in Supabase migration set. The local schema includes intelligence tables such as `interaction_events`, `user_interests`, `user_goals`, `user_preference_profiles`, `user_profile_vectors`, `recommendations`, `memories`, `memory_questions`, and `daily_user_insights`; `user_value_hierarchy` is created dynamically by `valueHierarchySync.js`. The Supabase migrations cover the ideal-state core, private messenger extensions, direct news-watch preferences, and AI chat history, but do not provide explicit hosted migrations for the full local intelligence/story hierarchy, Meta inbox, shared experience, music, or all opportunity-specific tables.

This is the main structural blocker for claiming one production intelligence spine: local SQLite behavior and hosted Supabase behavior are not yet demonstrably schema-equivalent.

## Current release boundary

The current repository is a verified local web/backend build, not a fully proven production/mobile release. The next work should be sequenced as:

1. Define one canonical intelligence contract for theory, story layers, topics, source edges, content, reasons, and feedback.
2. Add and validate SQLite/Supabase parity for that contract.
3. Surface reason traces and correction controls on every major recommendation surface.
4. Run live provider probes, complete Meta/Gmail OAuth checks, and verify FCM/deep links on a real Android install.
5. Re-run release verification with an authenticated protected-route token and record the resulting evidence.

## Implementation completion update — 2026-07-13

All repository-scoped phases from the Life Directed Intelligence brief are now implemented and locally verified. This does not convert external-provider or physical-device gates into verified facts.

### Completed phases

- Phase 0: current checkout truth, deterministic backend testing, lint boundary repair, Redis-offline degradation, and dependency repair are documented and reproducible.
- Phase 1: `backend/src/services/intelligenceContract.js` defines explanation schema `1.0`, story-layer alignment, source trust, freshness, ranking scores, action, confidence, and evidence. Feedback persists explicit theory evidence and rating/correction signals.
- Phase 2: `topicService.js`, `/api/v1/topics`, and `/api/v1/source-web` provide natural-language topic instructions, version history, source suggestions, approval state, source checks, claims, evidence, and coverage gaps. SQLite schema and a Supabase/Postgres RLS migration are included.
- Phase 3: canonical explanations are attached to Priority Radar alerts and the existing event/ranking paths; direct alert interpretation remains provider-gated and is not fabricated.
- Phase 4: ranked YouTube discovery candidates now carry the canonical explanation contract, while the existing tracked-channel/topic-monitor and transcript/history boundaries remain explicit.
- Phase 5: Meta provider capability matrices are returned and displayed; Telegram and Slack are labeled manual clipboard/open-app handoffs with no simulated backend send or history.
- Phase 6: release-contract verification checks build metadata, Android/web asset alignment, hosted RLS/readiness artifacts, route readiness, and Topics navigation.

### Final local evidence

- `npm run verify` passed: lint with 0 errors, frontend verifiers, backend 218/218 tests, production build, news-page verifier, runtime smoke, and release-contract verification.
- Final verified build ID: `explore-20260713112437-339b72c6`.
- `node node_modules/@capacitor/cli/bin/capacitor copy android` completed; `out/__explore_build.json` and `android/app/src/main/assets/public/__explore_build.json` match this build ID.
- `npm --prefix backend ci` repaired an incomplete `googleapis` install encountered during the timed-out Android packaging attempt.

### Remaining external proof gates

- The Supabase/Postgres migration is checked in but has not been applied or remotely verified; the Supabase CLI is not installed in this checkout and no PostgreSQL runtime is configured.
- Gemini, YouTube, Meta, Gmail OAuth, FCM push, webhooks, and provider rate/permission behavior remain credential- and live-network-dependent.
- The configured Gradle release command timed out before producing a new APK/AAB. The existing release artifacts are older than the final build; Android asset alignment is proven, but native packaging, install, sign-in, push, deep links, and accessibility on a physical device remain unproven.
- The final smoke run intentionally skipped the authenticated notification-status check because no bearer token was supplied.
