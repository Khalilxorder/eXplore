# eXplore Project Plan

Goal: Life-directed intelligence.

Generated: 2026-05-25
Workspace: `C:\Users\khali\Desktop\eXPLORE`

## Source Evidence

- Local project handoff: `codex_handoff.md`
- Consolidated eXplore prompt file: `prompts_history.md`
- Redacted master prompt archive: `recovery_materials/notes/eXPLORE_Master_Prompt_Archive_2026-04-05.redacted.md`
- Antigravity/Gemini handoff: `C:\Users\khali\.gemini\antigravity\brain\7c7d4e6f-40f2-4c45-a179-cf676e2e3d25\codex_handoff.md`
- Visual design rules: `rules.txt` and `Rules for Visual Design.pdf`
- Current app source: `src/app`, `backend`, `backend/opportunities`
- Official Gemini docs checked on 2026-05-25: `https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash`

The historical source set is large. The repo-local handoff says the redacted master archive has 6,932 prompt entries, while `prompts_history.md` contains 104 extracted eXplore prompts. This plan consolidates the high-priority requirements visible in those indexed sources and keeps the archive paths as the source of truth for exact wording.

## Non-Negotiable Requirements

- Visual rules everywhere

  Every screen must follow Khalil's visual rules instead of one-off styling. The product should prioritize small but readable UI, clear row/column structure, balanced spacing, consistent container boundaries, and restrained color distribution. The strongest practical rule for the current app is: neutral structure first, accents only for meaning. Red belongs to danger or urgent issues, grey to low priority, blue to trust/stability, gold/yellow only for focused highlights, and purple only where imagination/vision is intentional. Text must never float without a clear container when it reads as a standalone block. Cards, tabs, controls, lists, and profile boxes should share the same visual grammar instead of each screen inventing its own.

- Gemini 3.5 pool

  Gemini should be the default AI provider when keys exist. The current official model code is `gemini-3.5-flash`, and the local backend already reports that as the default analysis and template model. The backend service supports `GOOGLE_AI_API_KEYS`, `GOOGLE_AI_API_KEY_1` through `GOOGLE_AI_API_KEY_10`, `GOOGLE_GEMINI_API_KEY`, and compatible fallbacks. After `npm run config:sync`, this machine currently exposes 4 usable Gemini keys to `backend/.env`; rotation is enabled. The goal is 5-10 valid keys, but the implementation must work with fewer and must never print secrets in logs, docs, UI, or chat.

- Three story layers

  The app's center is not generic news. It should route the internet through three story layers: highest-order life narrative, the person's own future life wish, and current lower-order goals. Highest-order means religious, biblical, mythic, and shared-humanity narrative patterns, including the Jordan Peterson / `We Who Wrestle with God` direction the user named. The personal layer should be a one-page future wish generated from SELF data. The current-goal layer should be editable from the User Profile information tab, and AI may suggest lower-order goals from the future wish, current context, location, and active life events.

- User profile boxes stay editable

  Do not remove the existing value of the User Profile information tab. Simplify by grouping, labeling, and progressively disclosing advanced detail. The ideal structure is five editable groups: Life Narrative, Future Wish, Current Goals, Evidence From SELF, and Filters / Do-Not-Show. Keep every meaningful field accessible, but move implementation detail and diagnostic complexity behind Advanced. Each box should say what decision it changes in the feed, opportunities, alerts, or recommendations.

- Internet data follows goals

  All ingested data should pass through the same routing chain: source, freshness, trust, user goal alignment, explanation, and action. Each item should be able to answer: why shown, why trusted, why now, which story layer it serves, and what action it suggests. The app should demote generic noise even if it is popular. The top surface should feel like a serious personal intelligence console, not a social feed or generic news app.

- Jobs and scholarships are first-class

  Opportunities must be ranked against the same life-goal hierarchy as the feed. Jobs should use `backend/opportunities/run_all.py`, `rank.py`, and `user_profile.json`; scholarships should use `backend/opportunities/scholarships.db` and the scholarship API. The UI should show freshness, source, deadline, fit reason, category, saved state, and next action. The default view should prioritize apply-now, flexible, Budapest/remote, psychology/AI/creative/research-aligned, and SPHERE-preserving opportunities. Expired scholarships should not pollute the default.

## Current Implementation Status

- AI model pool

  `backend/services/aiService.js` already implements provider selection, Gemini key validation, pooled-key rotation, cooldowns on 403/429/500/503, Gemini JSON generation, Gemini embeddings, OpenAI fallback, and model-pool status. `backend/test/aiServicePool.test.js` covers multi-key rotation. Current local status after config sync: Gemini active, 4 configured keys, rotation enabled, default model `gemini-3.5-flash`. Remaining work is to increase keys to 5-10 if more valid keys exist, add a safe diagnostics endpoint if needed, and ensure no UI or logs expose key values.

- Story hierarchy

  `backend/src/services/valueHierarchySync.js` already has `story_highest_order`, `story_yours`, `story_sub_stories`, `self_raw_data`, `scientific_profile_json`, and `labs_research_json`. The routes in `backend/src/routes/hierarchy.js` support current goal updates, three-story updates, digital footprint import, SELF data analysis, and state fetch. The tests cover SELF analysis and research-lab generation. Remaining work is mainly product integration: make the profile UI clearer, connect this state into every feed/opportunity ranking path, and show the user's editable hierarchy without clutter.

- Opportunities

  `backend/opportunities` has multi-source job scrapers, ranking categories, a user profile, ranked JSON outputs, a scholarship SQLite database, a service layer, and API routes. `src/app/components/OpportunitiesScreen.js` consumes those APIs and includes jobs, scholarships, saved opportunities, and labs research. Remaining work is freshness and alignment: show exact last scrape/update evidence, run sweeps safely, tie ranking explanations to the three story layers, and make the scholarship results goal-connected instead of just searchable.

- Visual design

  `rules.txt` gives a design system philosophy, but the app still mixes old themes, hardcoded colors, generated-character encoding artifacts, and screen-specific styling. `src/app/globals.css` has a real token system, but some screens likely bypass it with inline colors and broken glyphs. Remaining work is an audit pass across the high-priority screens, especially User Profile / Preferences, Opportunities, Saved, Home, Priority Radar, Template, Culture, Nobel, and Written News.

## Recommended Profile Box Structure

- Life Narrative

  Highest-order interpretive frame. Default seed: shared-humanity and biblical narrative patterns, with a Jordan Peterson / meaning-through-responsibility lens. This box affects deep interpretation, long-term relevance, and which apparently unrelated signals are allowed into the user's world.

- Future Wish

  One-page desired future life generated from SELF results and manually editable by the user. This box should be the main personal north star. It affects ranking, opportunity matching, research/lab recommendations, and the AI's suggested current goals.

- Current Goals

  Short-term lower-order goals, typed by the user or suggested by AI from the Future Wish. This is the highest-weight live filter for news, jobs, scholarships, alerts, and daily recommendations. It should support multiple active goals, each with priority and optional deadline.

- Evidence From SELF

  Raw SELF summary, scientific profile, personality, narrative identity, cognitive style, and confidence notes. This should be visible enough to inspect but not overloaded. It should never pretend to be medical diagnosis; it should be treated as a decision-support profile.

- Filters / Do-Not-Show

  Topics, formats, sources, and opportunity types to suppress. This preserves value by turning negative preferences into an explicit guardrail. It should include avoid-topics, low-signal sources, hard job blacklists, minimum compensation, language constraints, deadline rules, and alert strictness.

## Execution Phases

- Phase 1: Source truth and safety

  Keep using the redacted archive for prompt history. Do not publish or paste secrets from old prompt archives. Run `npm run config:sync` before credential questions. Fix README paths that still mention `C:\Users\Administrator` if the active workspace stays under `C:\Users\khali`. Add a no-secrets diagnostics habit for all AI-key checks.

- Phase 2: Visual design compliance

  Build a screen-by-screen checklist from `rules.txt`: shape consistency, row/column layout, balanced spacing, neutral/accent ratio, readable typography, container boundaries, and no overlapping text. Remove broken encoding glyphs from source comments and visible strings. Replace hardcoded UI colors with tokens unless a color has explicit semantic meaning. Verify desktop and mobile with browser screenshots.

- Phase 3: Profile hierarchy productization

  Make the User Profile information tab the heart of the product. Keep all boxes editable, but merge them into the five groups above. Add short "affects" labels for each group. Save all groups through the existing hierarchy routes. Show whether the latest feed and opportunities are using the saved hierarchy.

- Phase 4: Goal-routed feed

  Route every feed item through trust, freshness, story-layer alignment, and actionability. Extend `evaluateContentAgainstHierarchy` usage so Home, Written News, Priority Radar, and detail explanations all show the same reason model. Add clear chips: Life Narrative, Future Wish, Current Goal, Official Source, Fresh, Trusted, Actionable.

- Phase 5: Opportunities integration

  Make Opportunities a direct extension of the life plan. Run job scraper sweeps and scholarship queries from safe buttons or backend jobs. Show last updated timestamps, source counts, active/expired counts, and why each opportunity matches SPHERE, psychology, AI, creativity, research, Budapest, remote, funding, or deadline needs. The first default should be the practical "apply now" queue, not browse mode.

- Phase 6: Gemini pool hardening

  Keep `gemini-3.5-flash` as the default model while official docs support it. Use 5-10 keys when available, but report only counts and health. Add backend test coverage for 10-key parsing, `GOOGLE_AI_API_KEYS` comma/newline lists, cooldown recovery, and malformed key rejection. Add a private diagnostics route that returns provider, model, key count, rotation enabled, and last error class only.

- Phase 7: Verification and release

  Run `npm run lint`, `npm run test:backend`, `npm run build`, and `npm run smoke:runtime` after implementation changes. Start the local stack and verify the actual UI in a browser. Android readiness still needs real device verification for notification permission, push token registration, FCM delivery, local fallback worker, and notification deep links.

## Definition Of Done

- The app can state the user's three story layers and uses them in ranking.
- The User Profile information tab is editable, simpler, and value-preserving.
- Gemini 3.5 Flash is the default model, with safe key rotation and no secret leakage.
- Jobs and scholarships show latest available data, update evidence, and goal-fit explanations.
- Each important feed item explains why shown, why trusted, why now, and which goal it serves.
- Visual design follows the user's rules on desktop and mobile: balanced layout, readable type, restrained color, clear containers, no overlap.
- Verification commands pass, and browser screenshots confirm the app is usable rather than just compiling.

## Immediate Next Actions

- Run a no-write visual audit of User Profile / Preferences, Opportunities, Home, and Template.
- Remove visible encoding artifacts and hardcoded color drift from source files.
- Add a profile-hierarchy UI cleanup without deleting any existing value fields.
- Add opportunities freshness and goal-fit labels.
- Add 10-key Gemini pool tests and a safe pool-status route.
- Re-run verification and browser screenshots.
