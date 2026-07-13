import fs from 'node:fs';
import path from 'node:path';
import puppeteer from '../backend/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js';

const root = process.cwd();
const docsDir = path.join(root, 'docs');
const dateStamp = '2026-06-06';
const baseName = `eXplore_Final_State_Wish_Assessment_${dateStamp}`;
const mdPath = path.join(docsDir, `${baseName}.md`);
const htmlPath = path.join(docsDir, `${baseName}.html`);
const pdfPath = path.join(docsDir, `${baseName}.pdf`);

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const promptsHistory = read('prompts_history.md');

const lines = [];
const add = (value = '') => lines.push(value);

add('# eXplore Final State Wish Assessment');
add('');
add('Goal: Life Directed Intelligence.');
add('');
add(`Generated: ${dateStamp}`);
add('Workspace: C:/Users/khali/Desktop/eXPLORE');
add('Primary thread assessed: 019e7add-d7dc-78c3-8387-bc605b99f379');
add('');
add('## Scope And Method');
add('');
add('- This document turns the user wishes, prompt history, Codex work records, and current repository state into a single final-state assessment.');
add('- It uses the local prompt extraction, project plan, handoff file, previous final-wish report, the exact 019e7add rollout summary, and current command results from this machine.');
add('- It intentionally avoids copying secrets from old archives or env files. Secret-bearing sources are named as evidence locations only.');
add('- It separates ideal product wish, implemented reality, verification results, blockers, and the path to the final version.');
add('');
add('## Executive Truth');
add('');
add('- Life Directed Intelligence');
add('');
add('  The strongest final goal remains a personal intelligence system that routes internet data through the user life direction. eXplore should not behave like a generic news feed, job board, saved-links tool, or decorative AI dashboard. The app should decide what to show by combining source trust, freshness, goal alignment, story-layer meaning, and next action. The most important product center is the editable user profile because it defines the ranking lens for news, opportunities, notifications, saved content, and future AI recommendations. The current codebase has real pieces of this goal: story-layer fields, a hierarchy scoring service, opportunity profile scoring, radar source rules, push notification plumbing, and source coverage reporting. The remaining gap is product unity. The app still needs every main surface to visibly prove the same logic: why shown, why now, why trusted, which life layer it serves, and what the user should do next.');
add('');
add('- Current State');
add('');
add('  The app is no longer only an idea or thin shell. The current Desktop workspace contains the real frontend, backend, Android, opportunity, radar, notification, and release surfaces. Config sync works from the machine-level services file and populated `.env.local`, `backend/.env`, and `android/app/google-services.json`. Frontend verifier passed. Backend tests passed with 143 tests. Production build passed and generated static output. Runtime smoke passed when rerun after build. Full `npm run verify` does not pass today because ESLint scans generated Chrome profile artifacts under `artifacts/chrome-news-check-profile/...` and reports two React display-name errors in extension files that are not app source. This is still a release-process blocker because the official verify command fails, but it is not evidence that the app logic tests are broken.');
add('');
add('- Main Blockers');
add('');
add('  The main blocker is not missing ambition; it is closing the reliability gap between many implemented systems and a final trusted product. Jobs coverage is present but stale. Scholarship coverage is present but the snapshot is stale and seven sources are portal-only. Push and direct-news notification code exists, but final release needs device/emulator proof for permission, token registration, FCM delivery, local fallback, and deep links. Supabase/Auth release settings still need final URL allowlisting if not already handled outside this run. The lint command needs an ignore boundary so generated browser-profile artifacts do not break the release gate. Finally, the final theory feedback loop, where the user rates interest/value from 1 to 10 and corrects the AI theory of the user, is still a product requirement that is not finished as a full visible loop.');
add('');
add('## The Final Wish Model');
add('');
add('- Three Story Layers');
add('');
add('  eXplore should organize the world through three layers. The highest-order layer is the life narrative: biblical, religious, mythic, shared-humanity, responsibility, and meaning patterns, including the Jordan Peterson and `We Who Wrestle With God` direction. The personal layer is the user future wish: a one-page future life direction informed by SELF data and editable by the user. The current layer is made of lower-order goals: immediate practical goals, active events, deadlines, location constraints, job needs, scholarship needs, research direction, and life tasks. A final version should let the user edit all three layers, then prove that feed ranking, opportunity ranking, radar filtering, and notifications actually use them.');
add('');
add('- Final Theory');
add('');
add('  The user also asked for an editable final theory: the theory that AI holds about the user in final analysis. In concrete product terms, this should be a preference and evidence loop, not vague model training. The user should be able to say an item is valuable or not valuable, rate it from 1 to 10, explain why, and see the app update the profile theory. That feedback should affect future ranking, suppress repeated mistakes, and preserve a visible history of corrections. The current repo has template memory and profile alignment pieces, but the rating-to-theory loop still needs to become a first-class user flow.');
add('');
add('- Visual Rules');
add('');
add('  The visual wish is strict. eXplore must follow the user visual design rules everywhere: clear containers, no loose text, no overlapping elements, high readability, restrained colors, useful accent meaning, balanced spacing, exact `eXplore` casing, and a quiet serious interface. The older warm/golden/time-aware theme is a recurring preference signal. The final app should not feel like a generic generated SaaS page. It should feel like a personal intelligence console: dense enough to act from, calm enough to trust, and visually consistent from profile to radar to opportunities.');
add('');
add('## Current Implementation Evidence');
add('');
add('- Story Hierarchy');
add('');
add('  Current source includes `story_highest_order`, `story_yours`, and `story_sub_stories` fields in `backend/src/services/valueHierarchySync.js`. It exposes story alignment through `backend/src/routes/hierarchy.js` at `/story-alignment`. The service includes `evaluateContentAgainstHierarchy`, SELF analysis, and labs research generation. This means the backend can already represent the three-layer wish and score content against it without requiring every operation to call AI. The remaining product work is to make this alignment unavoidable in the frontend: Home, Written News, Priority Radar, Opportunities, Saved, and Detail should all show the same story-layer reasoning.');
add('');
add('- Opportunities');
add('');
add('  Current source includes `getOpportunitySourceCoverage`, `scoreScholarshipProfileFit`, `profile_match_score`, `profile_match`, and `compareScholarshipsByProfileFit` in `backend/opportunities/opportunitiesService.js`. The opportunities route exposes coverage. This directly serves the user request that jobs and scholarships should not be generic lists; they should be connected to user goals. Current live coverage on this machine reported jobs as 16 of 18 priority sources present, 16 stale, 2 missing, and 1 critical missing direct adapter. Scholarships reported 18 of 18 priority sources present, 11 covered, 0 missing, 7 portal-only, and a stale scholarship snapshot. This is a real subsystem, but freshness is not final.');
add('');
add('- News Radar');
add('');
add('  Current source includes a dedicated `ai-investable-shares` lane, `RADAR_REFERENCE_POINTS`, and `DIRECT_NEWS_NOTIFICATION_RULES` in `backend/src/services/alertRadarService.js`. Tests cover official release selection, xAI inclusion, direct investable-share alerts, geo/political alerts, stale research rejection, customer-story rejection, and delivery only for selected precision-rule sources. This is a major improvement over the reported old problem where the news page repeated stale items, went empty, showed unstable results, and missed valuable AI tools. The final requirement is to verify the live UI and cache behavior under real data refresh, not only unit tests.');
add('');
add('- Notifications');
add('');
add('  Current source includes Capacitor push registration, local notifications, notification action routing, FCM payload construction, device-token storage, preference updates, priority radar deep links, private-message notification payloads, and tests for push delivery decisions. This is a real notification foundation. It still needs final Android proof because push systems are only truly done after a device or emulator receives a notification, opens the correct screen, and behaves correctly when permission is denied, token registration fails, or the app is backgrounded.');
add('');
add('- AI Model Pool');
add('');
add('  Current secret-free diagnostics report `provider: gemini`, `model: gemini-2.5-flash-lite`, `keyCount: 9`, `availableKeyCount: 9`, `rotationEnabled: true`, and `degraded: false`. This means the current machine now satisfies the spirit of the old 5-10 key request with 9 available Gemini keys, though the current model in code is `gemini-2.5-flash-lite`, not the older prompt wording of Gemini Flash 3.5. Tests verify pooled keys, cooldowns, placeholder rejection, comma/newline parsing, one hundred indexed keys, safe diagnostics, and sanitized failures.');
add('');
add('## Verification Results From 2026-06-06');
add('');
add('- `npm run config:sync`: passed. It synced machine config from `C:/Users/khali/.dev-config/services.json` into `.env.local`, `backend/.env`, and `android/app/google-services.json`.');
add('- `npm run test:frontend`: passed. Event priority verifier passed with 5 lanes, 38 sources, and 20 AI Advantage sources.');
add('- `npm run test:backend`: passed. Node test runner reported 143 tests, 143 passing, 0 failing.');
add('- `npm run build`: passed. Next.js production build compiled successfully, generated static pages, and wrote build metadata `explore-20260606033347-0724b958`.');
add('- `npm run smoke:runtime`: passed when rerun after the build finished.');
add('- `npm run verify`: failed at lint. ESLint scanned generated Chrome extension files under `artifacts/chrome-news-check-profile/...` and reported two `react/display-name` errors in `craw_background.js` and `craw_window.js`. This should be fixed by excluding generated artifacts from lint or moving browser profiles out of the lint tree, then rerunning the official verify command.');
add('');
add('## Prioritized Final Work');
add('');
add('- Fix Verify Gate');
add('');
add('  The first finalization task is to make the official `npm run verify` pass again. The clean fix is to update lint boundaries so generated artifacts, browser profiles, build outputs, and scratch captures are not linted as application source. This preserves strict linting for `src`, `backend/src`, backend services, scripts, and tests while removing false failures from generated extension code. After that, rerun `npm run verify` as the release gate.');
add('');
add('- Refresh Opportunities');
add('');
add('  The job and scholarship systems need a freshness pass. Jobs currently show broad source presence but stale evidence, so sweeps or source adapters need to run and report current timestamps. Scholarships show strong source presence but a stale snapshot and portal-only sources, so the official scholarship refresh path should run, and portal-only sources should either gain direct listing adapters or be labeled honestly in the UI. The final UI should default to an apply-now queue with deadlines, funding, source, freshness, and profile-fit reasons.');
add('');
add('- Prove Notifications');
add('');
add('  Notification readiness must be proven on Android. The repo has code and tests, but the final product needs device-level evidence: permission request, FCM token registration, backend token storage, priority alert delivery, local fallback scheduling, notification tap deep link, private-message notification path, and muted/disabled preference behavior. Until that is demonstrated, notifications should be called implemented-but-not-final.');
add('');
add('- Complete Final Theory');
add('');
add('  Build the visible user correction loop. Each feed item, opportunity, radar item, and saved item should allow a simple value signal: interested or not, 1-10 value score, and optional reason. Those corrections should update the user theory and be inspectable later. The AI should explain when it changed its theory and what future ranking will change. This is central because the final wish is not only to fetch information; it is to learn what the user values.');
add('');
add('- Unify Story Reasoning');
add('');
add('  The story hierarchy exists in backend code, but the final app must make it visible. Every important item should carry chips or compact explanations: Life Narrative, Future Wish, Current Goal, Official Source, Fresh, Trusted, Actionable. The same explanation grammar should appear across Home, Written News, Priority Radar, Opportunities, Saved, and Detail. This is what will make the app feel like one intelligence system instead of several separate tools.');
add('');
add('- Finish Release Settings');
add('');
add('  Confirm Supabase Auth URL allowlisting for the production URL and mobile callback, then test signup/login on web and Android. Confirm public legal pages, account deletion, privacy, contact, terms, Android cleartext settings, backup settings, production backend URL preference, and deployment envs. The current build passes, but release readiness also depends on cloud settings and Android runtime proof.');
add('');
add('## Source Map');
add('');
add('- `prompts_history.md`: compact local extraction of 104 eXplore prompts.');
add('- `PROJECT_PLAN.md`: product plan around Life Directed Intelligence, visual rules, Gemini, story layers, opportunities, and release.');
add('- `codex_handoff.md`: repo-local handoff, architecture, prompt archive stats, implementation surfaces, and risks.');
add('- `docs/eXplore_Final_Wish_Codex_Report_2026-06-01.md`: prior final-wish and Codex work report.');
add('- `C:/Users/khali/.codex/memories/rollout_summaries/2026-05-30T21-50-19-0k2J-explore_opportunities_news_radar_direct_notifications.md`: exact rollout summary for thread `019e7add-d7dc-78c3-8387-bc605b99f379`.');
add('- `backend/src/services/valueHierarchySync.js` and `backend/src/routes/hierarchy.js`: story-layer and SELF/labs alignment implementation.');
add('- `backend/opportunities/opportunitiesService.js` and `backend/src/routes/opportunities.js`: opportunity coverage, scholarship fit, and source reporting implementation.');
add('- `backend/src/services/alertRadarService.js` and `backend/src/services/pushDeliveryService.js`: radar filtering, direct notification rules, and push delivery implementation.');
add('- `src/app/lib/pushNotifications.js`, `src/app/lib/notifications.js`, and `src/app/components/PriorityRadarPhoneSetup.js`: frontend/native notification setup.');
add('- `backend/services/aiService.js` and `backend/test/aiServicePool.test.js`: Gemini pool, diagnostics, cooldowns, and secret-safe tests.');
add('');
add('## Appendix A: Exact 019e7add Goal');
add('');
add('The exact active objective from thread `019e7add-d7dc-78c3-8387-bc605b99f379` was:');
add('');
add("> Fix the Scholarship and Job portals making sure that thye cover all the important 100% suitable and doesn't miss any in connectino to my user-profile. The news page is very bad, first it shows the same news for days and weeks, it also shows an empty page unless I refresh many times and it shows then some news and then removes and shows others then shows all -- it is very unstable it should show direclty all. there are no notificatinos. the news filtering is very bad, I don't see any valuable ai tools news other than some models releases especially anthropic's one, yet my goal is all ai tools that are very valuable to me. it had shown news on useless topics to me also. Fix all of those at the core. use 4 agents to get it done");
add('');
add('## Appendix B: Complete Local eXplore Prompt Extraction');
add('');
add(promptsHistory);

fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderMarkdownish(markdown) {
  const escaped = escapeHtml(markdown);
  return escaped
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^\- (.*)$/gm, '<li>$1</li>')
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .split(/\n{2,}/)
    .map((block) => {
      if (/^\s*<(h1|h2|h3|li|blockquote)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>eXplore Final State Wish Assessment</title>
  <style>
    @page { margin: 22mm 18mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #202124; line-height: 1.48; font-size: 10.8pt; }
    h1 { font-size: 26pt; margin: 0 0 12pt; color: #111827; }
    h2 { font-size: 17pt; margin: 22pt 0 8pt; border-bottom: 1px solid #d7dce2; padding-bottom: 4pt; color: #1f2937; }
    h3 { font-size: 13pt; margin: 14pt 0 6pt; color: #374151; }
    p { margin: 0 0 8pt; }
    li { margin: 5pt 0 3pt 16pt; }
    blockquote { border-left: 4px solid #d8a31a; margin: 8pt 0 10pt; padding: 6pt 10pt; background: #fff8df; color: #2b2b2b; }
    code { font-family: Consolas, monospace; background: #eef2f7; padding: 1pt 3pt; border-radius: 3px; }
  </style>
</head>
<body>
${renderMarkdownish(lines.join('\n'))}
</body>
</html>`;

fs.writeFileSync(htmlPath, html, 'utf8');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'load' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size:8px;color:#666;width:100%;padding:0 18mm;">eXplore Final State Wish Assessment</div>',
    footerTemplate: '<div style="font-size:8px;color:#666;width:100%;padding:0 18mm;text-align:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
  });
} finally {
  await browser.close();
}

const stat = fs.statSync(pdfPath);
console.log(JSON.stringify({ mdPath, htmlPath, pdfPath, pdfBytes: stat.size }, null, 2));
