import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src/app'];
const targetExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
const guardedPrefixes = ['selected'];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if ([...targetExtensions].some((extension) => fullPath.endsWith(extension))) {
      files.push(fullPath.replaceAll('\\', '/'));
    }
  }
  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDeclared(source, identifier) {
  const name = escapeRegExp(identifier);
  const declarationPatterns = [
    new RegExp(`\\b(?:const|let|var|function)\\s+(?:\\[\\s*)?${name}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`),
    new RegExp(`\\(\\s*${name}\\s*\\)\\s*=>`),
    new RegExp(`\\b${name}\\s*=>`),
    new RegExp(`[,({]\\s*${name}\\s*[,)=}]`),
  ];
  return declarationPatterns.some((pattern) => pattern.test(source));
}

const files = roots.flatMap((root) => walk(root));
const problems = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const references = new Set();

  for (const prefix of guardedPrefixes) {
    const referencePattern = new RegExp(`\\b${prefix}[A-Z][A-Za-z0-9_]*\\b`, 'g');
    for (const match of source.matchAll(referencePattern)) {
      references.add(match[0]);
    }
  }

  for (const identifier of references) {
    if (!isDeclared(source, identifier)) {
      problems.push({ file, identifier });
    }
  }
}

const result = {
  passed: problems.length === 0,
  checkedFiles: files.length,
  guardedPrefixes,
  problems,
};

console.log(JSON.stringify(result, null, 2));

if (problems.length) {
  process.exit(1);
}
