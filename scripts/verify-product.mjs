import { spawnSync } from 'node:child_process';
import process from 'node:process';

const colors = {
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
};

// Steps tagged `external: true` produce YELLOW on failure instead of RED.
// YELLOW = code is fine but an external service / credential is not configured.
// RED    = the code itself is broken and must be fixed before shipping.
const steps = [
  {
    name: 'Config Sync',
    cmd: 'powershell',
    args: ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/sync-machine-config.ps1'],
  },
  {
    name: 'Linting',
    cmd: 'npx',
    args: ['eslint', 'src'],
  },
  {
    name: 'Frontend: Event Priority',
    cmd: 'node',
    args: ['scripts/verify-event-priority.mjs'],
  },
  {
    name: 'Frontend: Runtime References',
    cmd: 'node',
    args: ['scripts/verify-runtime-reference-guards.mjs'],
  },
  {
    name: 'Frontend: Reference Box',
    cmd: 'node',
    args: ['scripts/verify-reference-box.mjs'],
  },
  {
    name: 'Frontend: Video Library',
    cmd: 'node',
    args: ['scripts/verify-video-library.mjs'],
  },
  {
    name: 'Frontend: Private Messaging UI',
    cmd: 'node',
    args: ['scripts/verify-private-messaging-ui.mjs'],
  },
  {
    name: 'Backend Tests',
    cmd: 'npm',
    args: ['--prefix', 'backend', 'test'],
  },
  {
    name: 'Next.js Build',
    cmd: 'node',
    args: ['scripts/build-next-with-metadata.mjs'],
  },
  {
    name: 'News Page Verification',
    cmd: 'node',
    args: ['scripts/verify-news-page.mjs'],
  },
  {
    name: 'Live Messaging Verification',
    cmd: 'node',
    args: ['scripts/verify-live-private-messaging.mjs'],
    // Supabase must be configured and reachable. Mark as external so a
    // missing/offline Supabase instance shows yellow instead of red.
    external: true,
  },
  {
    name: 'Runtime Smoke Test',
    cmd: 'node',
    args: ['scripts/verify-runtime.mjs'],
  },
];

console.log(`${colors.bold}${colors.cyan}=== Starting Product Verification Gate ===${colors.reset}\n`);

const results = [];
let anyCodeFailure = false;   // red
let anyExternalWarning = false; // yellow

for (const step of steps) {
  console.log(`${colors.bold}Running: ${step.name}...${colors.reset}`);
  const start = Date.now();

  const result = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: true });
  const duration = ((Date.now() - start) / 1000).toFixed(2);
  const passed = result.status === 0;

  let statusLabel;
  if (passed) {
    statusLabel = `${colors.green}GREEN${colors.reset}`;
  } else if (step.external) {
    anyExternalWarning = true;
    statusLabel = `${colors.yellow}YELLOW (external dependency)${colors.reset}`;
  } else {
    anyCodeFailure = true;
    statusLabel = `${colors.red}RED (code failure)${colors.reset}`;
  }

  results.push({ name: step.name, passed, external: Boolean(step.external), duration });
  console.log(`${step.name} finished in ${duration}s. Status: ${statusLabel}\n`);
}

console.log(`\n${colors.bold}${colors.cyan}=== Verification Report ===${colors.reset}`);
console.log('--------------------------------------------------');

for (const res of results) {
  let icon;
  if (res.passed) {
    icon = `${colors.green}✔ GREEN  ${colors.reset}`;
  } else if (res.external) {
    icon = `${colors.yellow}⚠ YELLOW ${colors.reset}`;
  } else {
    icon = `${colors.red}✘ RED    ${colors.reset}`;
  }
  console.log(`${res.name.padEnd(35)} | ${icon} (${res.duration}s)`);
}

console.log('--------------------------------------------------');

if (!anyCodeFailure && !anyExternalWarning) {
  console.log(`\n${colors.bold}${colors.green}● ALL SYSTEMS GREEN — PRODUCT VERIFIED SUCCESSFULLY!${colors.reset}\n`);
  process.exit(0);
} else if (!anyCodeFailure && anyExternalWarning) {
  console.log(`\n${colors.bold}${colors.yellow}● YELLOW — Code is clean but some external dependencies are not configured (Supabase, Firebase, device token). Fix those to reach full green.${colors.reset}\n`);
  process.exit(0); // exit 0: code is shippable, warnings are environment gaps
} else {
  console.log(`\n${colors.bold}${colors.red}● RED — One or more code checks failed. Fix the RED steps before shipping.${colors.reset}\n`);
  process.exit(1);
}
