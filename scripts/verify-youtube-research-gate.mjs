import { readFileSync } from 'node:fs';

const files = {
  external: readFileSync('src/app/lib/external.js', 'utf8'),
  modal: readFileSync('src/app/components/YoutubeResearchGateModal.js', 'utf8'),
  detail: readFileSync('src/app/components/DetailScreen.js', 'utf8'),
  experience: readFileSync('src/app/components/ExperienceScreen.js', 'utf8'),
  sharedExperience: readFileSync('src/app/components/SharedExperienceScreen.js', 'utf8'),
  api: readFileSync('src/app/lib/api.js', 'utf8'),
  server: readFileSync('backend/server.js', 'utf8'),
};

const required = [
  ['external interception', files.external, 'openYouTubeResearchGate'],
  ['external event', files.external, 'explore:open-youtube-gate'],
  ['read-only inspection client', files.api, 'inspectYouTubeResearchUrl'],
  ['read-only inspection endpoint', files.server, '/api/v1/research/youtube/inspect'],
  ['no ingestion in inspection endpoint', files.server, 'Read-only research inspection'],
  ['metadata gate', files.modal, 'Phase 1 verified'],
  ['purpose gate', files.modal, 'purpose.trim().length >= 12'],
  ['explicit confirmation', files.modal, 'setConfirmed'],
  ['sandboxed player', files.modal, 'sandbox="allow-scripts allow-same-origin allow-presentation"'],
  ['restricted player permissions', files.modal, 'allow="autoplay; encrypted-media; picture-in-picture; fullscreen"'],
  ['detail screen route', files.detail, 'Open controlled research gate'],
  ['experience screen route', files.experience, 'Review this match in the research gate'],
  ['shared experience route', files.sharedExperience, 'Review in research gate'],
];

const missing = required.filter(([, source, marker]) => !source.includes(marker)).map(([name]) => name);
const forbidden = [
  ['modal popup permission', files.modal, 'allow-popups'],
  ['experience direct iframe', files.experience, '<iframe'],
  ['shared experience direct iframe', files.sharedExperience, '<iframe'],
].filter(([, source, marker]) => source.includes(marker)).map(([name]) => name);

const result = { passed: !missing.length && !forbidden.length, missing, forbidden };
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exit(1);
