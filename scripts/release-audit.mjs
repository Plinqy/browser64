import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const expectedVersion = '1.0.0';
const failures = [];

function fail(message) {
  failures.push(message);
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (pkg.version !== expectedVersion) fail(`package.json version is ${pkg.version}, expected ${expectedVersion}.`);

const releaseSource = await readFile(join(root, 'src/release.ts'), 'utf8');
if (!releaseSource.includes(`EMULATOR_VERSION = '${expectedVersion}'`)) {
  fail('src/release.ts does not match package.json release version.');
}

const markdownFiles = await walkMarkdown(root);
for (const path of markdownFiles) {
  const text = await readFile(path, 'utf8');
  const rel = relative(root, path);
  if (/\bv0\.\d+/i.test(text) || /\bversion\s+0\.\d+/i.test(text)) {
    fail(`${rel} still contains pre-1.0 milestone/version prose.`);
  }
}

const readme = await readFile(join(root, 'README.md'), 'utf8');
if (!readme.includes('Version **1.0.0**')) fail('README.md does not identify Version 1.0.0.');
for (const required of ['Enter BASIC programs', 'D64 / G64', 'T64', 'Known accuracy boundaries']) {
  if (!readme.includes(required)) fail(`README.md is missing the release section/phrase: ${required}`);
}

const verification = await readFile(join(root, 'VERIFICATION.md'), 'utf8');
if (!verification.startsWith('# v1.0 Verification')) fail('VERIFICATION.md is not the v1.0 verification document.');

const coreRoot = join(root, 'src/core');
for (const entry of await readdir(coreRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = join(coreRoot, entry.name);
  const children = await readdir(directory);
  if (children.some((name) => name.endsWith('.ts')) && !children.includes('README.md')) {
    fail(`src/core/${entry.name} contains TypeScript source but no README.md.`);
  }
}

if (failures.length > 0) {
  console.error('Release documentation audit failed:');
  for (const message of failures) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log(`Release audit passed: ${markdownFiles.length} Markdown/README files reviewed for ${expectedVersion}.`);
}

async function walkMarkdown(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkMarkdown(path));
      continue;
    }
    if (entry.name.toLowerCase().endsWith('.md') || entry.name.toLowerCase().startsWith('readme')) {
      results.push(path);
    }
  }
  return results.sort();
}
