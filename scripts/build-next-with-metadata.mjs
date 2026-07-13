import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, '..');
const packageInfo = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8'));
const now = new Date();
const buildTime = process.env.EXPLORE_BUILD_TIME || now.toISOString();
const fallbackBuildId = `explore-${now.toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
const buildId = process.env.EXPLORE_BUILD_ID || fallbackBuildId;
const env = {
  ...process.env,
  EXPLORE_BUILD_ID: buildId,
  EXPLORE_BUILD_TIME: buildTime,
  NEXT_PUBLIC_BUILD_ID: buildId,
  NEXT_PUBLIC_BUILD_TIME: buildTime,
};
const nextBin = join(workspaceRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const build = spawnSync(process.execPath, [nextBin, 'build', '--webpack'], {
  cwd: workspaceRoot,
  env,
  stdio: 'inherit',
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const outDir = join(workspaceRoot, 'out');
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

const metadata = {
  app: 'eXPLORE',
  packageName: packageInfo.name,
  packageVersion: packageInfo.version,
  buildId,
  builtAt: buildTime,
  exportDir: 'out',
  releaseChannel: process.env.EXPLORE_RELEASE_CHANNEL || 'web',
  nodeVersion: process.version,
};

writeFileSync(
  join(outDir, '__explore_build.json'),
  `${JSON.stringify(metadata, null, 2)}\n`,
  'utf8'
);

console.log(`Wrote build metadata for ${buildId}`);
