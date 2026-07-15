import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(projectRoot, '.verify.lock');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock() {
  if (!existsSync(lockPath)) {
    return null;
  }
  try {
    const [pidLine, startedAt = 'unknown'] = readFileSync(lockPath, 'utf8').split('\n');
    return { pid: Number(pidLine.trim()), startedAt: startedAt.trim() || 'unknown' };
  } catch {
    return { pid: NaN, startedAt: 'unknown' };
  }
}

function acquireLock() {
  const existing = readLock();
  if (existing && isProcessAlive(existing.pid)) {
    console.error(
      `verify: blocked — another verify is already running (pid ${existing.pid}, started ${existing.startedAt}).`,
    );
    console.error('verify: wait for it to finish, or delete .verify.lock if that process crashed.');
    process.exit(1);
  }
  if (existsSync(lockPath)) {
    try {
      unlinkSync(lockPath);
    } catch {
      // stale lock from a crashed verify
    }
  }
  writeFileSync(lockPath, `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
}

function releaseLock() {
  try {
    const existing = readLock();
    if (existing?.pid === process.pid && existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  } catch {
    // best-effort cleanup
  }
}

const capacitorCli = join(
  projectRoot,
  'node_modules',
  '@capacitor',
  'cli',
  'bin',
  'capacitor',
);

const steps = [
  { label: 'lint', command: npmCmd, args: ['run', 'lint'] },
  { label: 'test:frontend', command: npmCmd, args: ['run', 'test:frontend'] },
  { label: 'test:backend', command: npmCmd, args: ['run', 'test:backend'] },
  { label: 'build', command: npmCmd, args: ['run', 'build'] },
  // Keep Android web assets on the same buildId as out/ for release-contract.
  {
    label: 'android-asset-sync',
    command: process.execPath,
    args: [capacitorCli, 'copy', 'android'],
    optionalIfMissing: capacitorCli,
  },
  { label: 'test:news-page', command: npmCmd, args: ['run', 'test:news-page'] },
  { label: 'smoke:runtime', command: npmCmd, args: ['run', 'smoke:runtime'] },
  {
    label: 'release-contract',
    command: process.execPath,
    args: [join(projectRoot, 'scripts', 'verify-release-contract.mjs')],
  },
];

acquireLock();

const cleanup = (code) => {
  releaseLock();
  process.exit(code);
};

process.on('SIGINT', () => cleanup(130));
process.on('SIGTERM', () => cleanup(143));

for (const step of steps) {
  if (step.optionalIfMissing && !existsSync(step.optionalIfMissing)) {
    console.warn(`verify: skipping ${step.label} (missing ${step.optionalIfMissing})`);
    continue;
  }
  const useShell = step.command === npmCmd && process.platform === 'win32';
  const result = spawnSync(step.command, step.args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    shell: useShell,
    windowsHide: true,
  });
  if (result.error) {
    console.error(`verify: failed to start ${step.label}: ${result.error.message}`);
    cleanup(1);
  }
  if (result.status !== 0) {
    cleanup(result.status ?? 1);
  }
}

releaseLock();