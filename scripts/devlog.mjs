// Generates a per-day development log from git history: one Markdown file per
// date under docs/devlog/, each listing that day's commits (subject + body).
// Deterministic and idempotent — re-running just refreshes today's file as new
// commits land, so it doubles as the daily auto-update.
//
//   node scripts/devlog.mjs        # regenerate all dated files from git log
//   npm run devlog
//
// docs/devlog/README.md is hand-written and never touched here.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'devlog');

// Unit/record separators keep multi-line commit bodies intact.
const US = '\x1f';
const RS = '\x1e';
const raw = execSync(`git log --date=short --reverse --pretty=format:"%ad${US}%h${US}%s${US}%b${RS}"`, {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

const byDate = new Map();
for (const rec of raw.split(RS)) {
  const line = rec.replace(/^\n+/, '');
  if (!line.trim()) continue;
  const [date, hash, subject, body = ''] = line.split(US);
  if (!byDate.has(date)) byDate.set(date, []);
  byDate.get(date).push({ hash, subject, body: body.trim() });
}

mkdirSync(OUT, { recursive: true });

for (const [date, commits] of byDate) {
  const lines = [`# 개발 일지 — ${date}`, '', `커밋 ${commits.length}개. (git 이력에서 자동 생성 — 직접 수정하지 마세요)`, ''];
  for (const c of commits) {
    lines.push(`## ${c.subject}`, '', `\`${c.hash}\``, '');
    if (c.body) {
      lines.push(c.body, '');
    }
  }
  writeFileSync(join(OUT, `${date}.md`), lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
}

const dates = [...byDate.keys()].sort().reverse();
console.log(`devlog: ${dates.length} day file(s) written (${dates.join(', ')})`);
