#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

async function main() {
  const currentVersion = JSON.parse(read('src-tauri/tauri.conf.json')).version;
  console.log(`Current app version: ${currentVersion}`);

  const prompt = createInterface({ input: stdin, output: stdout });
  let tag;
  try {
    tag = (await prompt.question('Tag to use (for example, v0.2.0): ')).trim();
  } finally {
    prompt.close();
  }
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Expected vMAJOR.MINOR.PATCH, for example v0.2.0. No files were changed.');
  }
  const version = tag.slice(1);

  // Validate and prepare every change before writing any file.
  const updates = new Map();
  for (const path of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
    const data = JSON.parse(read(path));
    if (typeof data.version !== 'string') {
      throw new Error(`Missing version in ${path}. No files were changed.`);
    }
    data.version = version;
    if (path === 'package-lock.json') {
      if (typeof data.packages?.['']?.version !== 'string') {
        throw new Error('Missing root package version in package-lock.json. No files were changed.');
      }
      data.packages[''].version = version;
    }
    updates.set(path, `${JSON.stringify(data, null, 2)}\n`);
  }

  function updateCargoVersion(path, pattern) {
    const content = read(path);
    if ([...content.matchAll(pattern)].length !== 1) {
      throw new Error(`Could not locate a unique Tyler version in ${path}. No files were changed.`);
    }
    updates.set(path, content.replace(pattern, (_, prefix, suffix) => `${prefix}${version}${suffix}`));
  }
  updateCargoVersion(
    'src-tauri/Cargo.toml',
    /^(\[package\]\r?\n[\s\S]*?^version\s*=\s*")[^"]+(")/gm,
  );
  updateCargoVersion(
    'src-tauri/Cargo.lock',
    /^(\[\[package\]\]\r?\nname = "tyler"\r?\nversion = ")[^"]+(")/gm,
  );

  for (const [path, content] of updates) {
    writeFileSync(new URL(path, root), content);
    console.log(`Updated ${path} to ${version}`);
  }
  console.log(`Version files are ready for ${tag}. No commit or Git tag was created or pushed.`);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
