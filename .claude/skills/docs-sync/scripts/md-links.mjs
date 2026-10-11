#!/usr/bin/env node
// Checks that every relative markdown link in README.md, TRANSFER-RU.md, AGENTS.md and docs/**/*.md points to an existing file.
// Anchors (#...) are not checked. Usage: node .claude/skills/docs-sync/scripts/md-links.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const files = ['README.md', 'TRANSFER-RU.md', 'AGENTS.md'].map(name => join(root, name)).filter(existsSync);
const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (name.endsWith('.md')) files.push(path); } };
walk(join(root, 'docs'));

let total = 0, bad = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('#')) continue;
    total++;
    if (!existsSync(resolve(dirname(file), link.split('#')[0]))) { bad++; console.log(`BAD ${relative(root, file)} -> ${link}`); }
  }
}
console.log(`md-links: ${total} links checked, ${bad} broken`);
process.exit(bad ? 1 : 0);
