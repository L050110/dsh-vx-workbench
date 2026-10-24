// Skill ledger: detect every SKILL.md on disk, fingerprint it, and diff against
// the previous scan so the workbench knowledge (docs/skills.md) iterates itself.
// Pure read-only scanning + one rendered markdown ledger. No agent, no network.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { createHash } from 'node:crypto';

const SKILL_FILE = 'SKILL.md';
const MAX_OTHER_FILES = 400;

const errText = (e) => String((e && e.message) || e);

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex').toUpperCase();
}

function safeStat(path) {
  try {
    const s = statSync(path);
    return { size: s.size, mtime: s.mtime.toISOString() };
  } catch (e) {
    return null;
  }
}

// name/description live in a leading YAML frontmatter block.
function parseFrontmatter(text) {
  const out = {};
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const hit = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!hit) continue;
    let value = hit[2].trim();
    if (value.length > 1 && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
    out[hit[1]] = value;
  }
  return out;
}

function firstHeading(text) {
  const m = /^#\s+(.+)$/m.exec(text);
  return m ? m[1].trim() : '';
}

// Fingerprint = SKILL.md bytes + the shape (path,size) of everything else in the
// skill directory, so adding/removing references also counts as a change.
function treeSignature(dir) {
  const rows = [];
  const walk = (abs, rel, depth) => {
    if (depth > 3 || rows.length >= MAX_OTHER_FILES) return;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      if (rows.length >= MAX_OTHER_FILES) return;
      const childAbs = join(abs, ent.name);
      const childRel = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) {
        walk(childAbs, childRel, depth + 1);
      } else if (ent.isFile() && ent.name !== SKILL_FILE) {
        const st = safeStat(childAbs);
        rows.push(childRel + ':' + (st ? st.size : '?'));
      }
    }
  };
  walk(dir, '', 0);
  rows.sort();
  return rows.join('|');
}

function readSkill(dir, file, root) {
  let text = '';
  let bytes = null;
  try {
    bytes = readFileSync(file);
    text = bytes.toString('utf8');
  } catch (e) {
    return { name: basename(dir), dir, file, root, error: errText(e) };
  }
  const fm = parseFrontmatter(text);
  const name = (fm.name || basename(dir)).trim();
  const description = (fm.description || firstHeading(text) || '').trim().replace(/\s+/g, ' ');
  const st = safeStat(file);
  const fingerprint = sha256(Buffer.concat([bytes, Buffer.from('\n#tree\n' + treeSignature(dir), 'utf8')])).slice(0, 32);
  return {
    name,
    source: 'fs',
    dir,
    file,
    root,
    description: description.slice(0, 400),
    bytes: bytes.length,
    size: st ? st.size : null,
    mtime: st ? st.mtime : null,
    fingerprint,
  };
}

// Identity across sources: a disk skill and a viking:// skill may share a name.
export function keyOf(s) {
  return (s.source || 'fs') + ':' + (s.name || '');
}

// Display label: OpenViking entries are marked so the ledger stays unambiguous.
export function labelOf(s) {
  return (s.source === 'openviking' ? s.name + ' (ov)' : s.name) || '';
}

// Roots in priority order: project-local first, then user-level, then shipped.
export function skillRoots({ home, profileDir, workspaceRoot, dshRoot }) {
  const roots = [];
  const push = (p) => {
    if (!p) return;
    const norm = String(p).replace(/[\\/]+$/, '');
    if (!roots.some((r) => r.toLowerCase() === norm.toLowerCase())) roots.push(norm);
  };
  if (workspaceRoot) {
    push(join(workspaceRoot, 'skills'));
    push(join(workspaceRoot, '.dsh', 'skills'));
  }
  if (profileDir) push(join(profileDir, 'skills'));
  if (home) {
    // The Host process does not always inherit DSH_PROFILE_DIR, so enumerate the
    // profile directories directly; absent ones stay listed with present=false.
    const profilesRoot = join(home, '.dsh', 'profiles');
    try {
      for (const ent of readdirSync(profilesRoot, { withFileTypes: true })) {
        if (ent.isDirectory()) push(join(profilesRoot, ent.name, 'skills'));
      }
    } catch (e) {}
    push(join(home, '.dsh', 'skills'));
  }
  if (dshRoot) push(join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills'));
  return roots;
}

export function scanSkills(roots) {
  const skills = [];
  const errors = [];
  const seen = new Set();
  for (const root of roots || []) {
    if (!existsSync(root)) {
      // Absent roots are normal (a profile may not use that location); the state
      // records them with present=false instead of reporting a scan error.
      continue;
    }
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch (e) {
      errors.push({ root, error: errText(e) });
      continue;
    }
    // A root may itself be a single skill (SKILL.md directly inside it).
    if (existsSync(join(root, SKILL_FILE))) {
      const one = readSkill(root, join(root, SKILL_FILE), root);
      const key = (one.name || '').toLowerCase() + '@' + root.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        skills.push(one);
      }
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dir = join(root, ent.name);
      const file = join(dir, SKILL_FILE);
      if (!existsSync(file)) continue;
      const one = readSkill(dir, file, root);
      const key = (one.name || ent.name).toLowerCase() + '@' + root.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push(one);
    }
  }
  skills.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { skills, errors };
}

export function digestOf(skills) {
  const rows = (skills || []).map((s) => keyOf(s) + ':' + (s.fingerprint || '')).sort();
  return sha256(Buffer.from(rows.join('\n'), 'utf8')).slice(0, 32);
}

// Compare against the previous scan's skill list. A first scan has no baseline:
// everything is listed as `initial`, nothing as `added`, so a fresh install does
// not read as "20 new skills appeared".
export function diffSkills(prevSkills, nextSkills) {
  const before = new Map((prevSkills || []).map((s) => [keyOf(s), s]));
  const added = [];
  const changed = [];
  const removed = [];
  const initial = before.size === 0;
  for (const s of nextSkills || []) {
    const old = before.get(keyOf(s));
    if (!old) {
      if (initial) continue;
      added.push(s);
    } else if (old.fingerprint !== s.fingerprint) {
      changed.push(s);
    }
  }
  const nextKeys = new Set((nextSkills || []).map(keyOf));
  for (const s of prevSkills || []) {
    if (!nextKeys.has(keyOf(s))) removed.push(s);
  }
  return { initial, added, changed, removed, digest: digestOf(nextSkills) };
}

function shortRoot(root, ctx) {
  const marks = [
    [ctx.workspaceRoot, '工作区'],
    [ctx.profileDir, 'profile'],
    [ctx.home, '~'],
    [ctx.dshRoot, 'dsh 内置'],
  ];
  for (const [base, label] of marks) {
    if (!base) continue;
    const b = String(base).replace(/[\\/]+$/, '');
    if (root.toLowerCase() === b.toLowerCase()) return label;
    if (root.toLowerCase().startsWith(b.toLowerCase() + '\\') || root.toLowerCase().startsWith(b.toLowerCase() + '/')) {
      return label + '/' + relative(b, root).split('\\').join('/');
    }
  }
  return root;
}

export function renderLedger(state, ctx) {
  const skills = state.skills || [];
  const fsSkills = skills.filter((s) => (s.source || 'fs') === 'fs');
  const ovSkills = skills.filter((s) => s.source === 'openviking');
  const ov = state.ov || {};
  const diff = state.diff || {};
  const lines = [];
  lines.push('# 技能台账（自动生成 · 请勿手改）');
  lines.push('');
  lines.push('> 由 vx-workbench 技能扫描器写盘：每次扫描重写本文件，检测到新增/变更/移除时同时写 `log.jsonl` 并（可选）通知会话。');
  lines.push('> 生成时间：' + (state.scannedAt || ''));
  lines.push('> 台账摘要：' + (state.count || 0) + ' 个技能（磁盘 ' + fsSkills.length + ' · OpenViking ' + ovSkills.length + '） · digest `' + (state.digest || '') + '`');
  lines.push('');
  lines.push('## 磁盘技能（`SKILL.md`）');
  lines.push('');
  lines.push('| 技能 | 来源 | 指纹 | 说明 |');
  lines.push('| --- | --- | --- | --- |');
  for (const s of fsSkills) {
    const src = shortRoot(s.root || '', ctx);
    const desc = (s.description || '').replace(/\|/g, '\\|').slice(0, 120);
    lines.push('| `' + s.name + '` | ' + src + ' | `' + String(s.fingerprint || '').slice(0, 8) + '` | ' + desc + ' |');
  }
  if (fsSkills.length === 0) lines.push('| （无） | - | - | 扫描根目录里没有 SKILL.md |');
  lines.push('');
  lines.push('## OpenViking 技能（`viking://`）');
  lines.push('');
  lines.push('获取状态：**' + (ov.status || 'unknown') + '**' +
    (ov.baseUrl ? ' · 端点 `' + ov.baseUrl + '`' : '') +
    (ov.capturedAt ? ' · 快照时间 ' + ov.capturedAt : '') +
    (ov.error ? ' · ' + ov.error : ''));
  lines.push('');
  if (ovSkills.length) {
    lines.push('| 技能 | 根 | 途径 | 指纹 | 说明 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const s of ovSkills) {
      const desc = (s.description || '').replace(/\|/g, '\\|').slice(0, 120);
      lines.push(
        '| `' + s.name + '` | ' + (s.rootUri || '') + ' | ' + (s.transport || '') + ' | `' +
          String(s.fingerprint || '').slice(0, 8) + '` | ' + desc + ' |'
      );
    }
  } else {
    lines.push('暂无。两条通道都空：直连（`~/.openviking/ov.conf` 的 `url` + `${baseUrl}/mcp`）未连通，也没有 `vx-workbench/ov-skills.json` 快照。');
    lines.push('');
    lines.push('补一次快照：任一会话调用 openviking 的 `tree(uri="viking://~/skills", level_limit=1, include_abstract=true)`（`viking://agent/skills` 同样来一遍），把结果 `POST /vxwb {"action":"ov-ingest","roots":{...}}`。');
  }
  lines.push('');
  lines.push('## 磁盘扫描根目录');
  lines.push('');
  for (const r of state.roots || []) {
    lines.push('- `' + r.root + '` — ' + (r.present ? '存在' : '不存在'));
  }
  lines.push('');
  lines.push('## 最近一次变化');
  lines.push('');
  lines.push('- 时间：' + (diff.at || state.scannedAt || ''));
  if (diff.initial) {
    lines.push('- 这是首次扫描（建立基线，不视为新增）。');
  } else {
    // state.diff entries arrive as display labels (strings) from the host half;
    // accept raw skill objects too so this renderer stays usable on its own.
    const show = (x) => (typeof x === 'string' ? x : labelOf(x));
    lines.push('- 新增：' + ((diff.added || []).map(show).filter(Boolean).join('、') || '无'));
    lines.push('- 变更：' + ((diff.changed || []).map(show).filter(Boolean).join('、') || '无'));
    lines.push('- 移除：' + ((diff.removed || []).map(show).filter(Boolean).join('、') || '无'));
  }
  lines.push('');
  lines.push('## 给会话的用法（省 token 的正确姿势）');
  lines.push('');
  lines.push('1. 需要某个技能时，先在这里查到它属于哪个根目录，再 `read` 那个目录下的 `SKILL.md`；不要凭记忆猜技能名。');
  lines.push('2. 本文件只做“索引 + 变化记录”，技能正文永远以各自的 `SKILL.md` 为准。');
  lines.push('3. 新技能装好后无需重启：下一次扫描（≤5 分钟）就会把它写进本文件。');
  lines.push('4. 标 `(ov)` 的是 OpenViking 技能：`viking://` 是库路径，**不能**给本地文件工具或 shell；要用 openviking 的 `read` 工具读 `<uri>/SKILL.md`。');
  lines.push('5. 本地与 OpenViking 同名时：本地优先（harness 已加载的那份算数）。');
  if ((state.errors || []).length) {
    lines.push('');
    lines.push('## 扫描异常');
    lines.push('');
    for (const e of state.errors) lines.push('- `' + e.root + '` — ' + e.error);
  }
  lines.push('');
  return lines.join('\n');
}
