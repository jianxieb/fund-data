#!/usr/bin/env node
// Keep published local asset URLs tied to their content, not a manually chosen date.
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = join(root, 'index.html');
const source = readFileSync(page, 'utf8');
const assets = new Set();
const expected = source.replace(/(\b(?:src|href)=")((?:assets|data)\/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?(")/g,
  (_match, prefix, asset, suffix) => {
    assets.add(asset);
    const digest = createHash('sha256').update(readFileSync(join(root, asset))).digest('hex').slice(0, 12);
    return `${prefix}${asset}?v=${digest}${suffix}`;
  });

if (!assets.size) throw new Error('index.html 没有找到本地 CSS/JS 资源');
if (process.argv.includes('--write')) {
  if (source !== expected) {
    const temporary = page + '.tmp';
    writeFileSync(temporary, expected);
    renameSync(temporary, page);
  }
  console.log(`已核对 ${assets.size} 个本地资源版本`);
} else if (source !== expected) {
  console.error('index.html 的资源版本与文件内容不一致；发布前运行 node scripts/cache_versions.mjs --write');
  process.exitCode = 1;
} else {
  console.log(`资源版本一致（${assets.size} 个）`);
}
