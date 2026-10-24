// Host half of the VX workbench.
// 1) live patch status (DLL bytes + strong-name bypass + process)
// 2) one-click install / restore
// 3) asset list + "reveal in explorer"
// 4) work log, and "ask" — pushes a real user message into the live session
// 5) ships docs/logic.md so the panel can explain how the crack and the workflow work
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { skillRoots, scanSkills, diffSkills, renderLedger, labelOf } from './lib/skills.mjs';
import { readOvConfig, fetchOvSkills, readSnapshot, snapshotPath, normalizeIngest, OV_ROOTS } from './lib/ov.mjs';
import { plan as planPatch } from './lib/patch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = 'vx-workbench';
const INSTALL_DIR = 'C:\\Program Files\\HANDI\\Visual X-Space 4.8';
const HOOPS_DLL = join(INSTALL_DIR, 'VisualComponents.HOOPS.dll');
const CRACK_DIR = 'C:\\Users\\lenovo\\Desktop\\VisualXSpace48_Crack_v3.0_HOOPS';
const DELIVERY_DIR = 'C:\\Users\\lenovo\\Desktop\\SU7_工厂交付';
const DESKTOP_DIR = 'C:\\Users\\lenovo\\Desktop';
const PATCH_OFFSET = 173095;
const ASM_KEY = 'VisualComponents.HOOPS,31bc53bc7503b77a';
const SKILL_SCAN_MS = 5 * 60 * 1000; // auto-scan cadence for the skill ledger
const BROADCAST_CAP = 40; // never fan out further than this in one press

export const inject = ['webServer', 'sessionController'];

function resolveRoot(ctx) {
  const env = process.env.VX_WORKBENCH_DIR;
  if (env && env.trim()) return env.trim();
  try {
    const reg = ctx.get('workspaceRegistry');
    if (reg && typeof reg.list === 'function') {
      for (const w of reg.list() || []) {
        const p = w && (w.path || (w.info && w.info.path));
        if (p && p.indexOf('.dsh') < 0) return p;
      }
    }
  } catch (e) {}
  try {
    const wd = ctx.get('workingDirectory');
    if (wd && wd.defaultDirectory) return wd.defaultDirectory;
  } catch (e) {}
  return process.cwd();
}

const errText = (e) => String((e && e.message) || e);

function run(cmd, args, timeout = 8000) {
  return new Promise((ok) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => {
        ok({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || '') });
      });
    } catch (e) {
      ok({ code: 1, out: '' });
    }
  });
}

// Locate the compatibility site by its machine-code shape, not by a fixed
// offset, so a different 4.8 build reports honestly instead of silently wrong.
function inspectDll() {
  try {
    const buf = readFileSync(HOOPS_DLL);
    const decision = planPatch(buf);
    const site = decision.target || (decision.sites && decision.sites[0]) || null;
    return {
      exists: true,
      size: buf.length,
      sha256: decision.sha256,
      state: decision.state, // patched | original | unknown
      action: decision.action, // already | patch | ambiguous | unsupported
      reason: decision.reason || '',
      sites: (decision.sites || []).length,
      candidates: decision.candidates || [],
      offset: site ? site.opcodeOffset : null,
      byte: site ? site.opcode : null,
    };
  } catch (e) {
    return { exists: false, error: errText(e) };
  }
}

function sha256(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
  } catch (e) {
    return null;
  }
}

function statOf(path) {
  try {
    const s = statSync(path);
    return { size: s.size, mtime: s.mtime.toISOString() };
  } catch (e) {
    return null;
  }
}

function readJsonl(path, limit) {
  try {
    const rows = readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (e) {
          return { at: '', text: l };
        }
      });
    return rows.slice(-limit);
  } catch (e) {
    return [];
  }
}

function listLayouts() {
  const seenNames = new Set();
  const out = [];
  const scan = (dir, filter) => {
    try {
      for (const name of readdirSync(dir)) {
        if (!filter(name)) continue;
        const key = name.toLowerCase();
        if (seenNames.has(key)) continue;
        const st = statOf(join(dir, name));
        if (!st) continue;
        seenNames.add(key);
        out.push({ name, path: join(dir, name), sizeMB: Number((st.size / 1048576).toFixed(2)), mtime: st.mtime, dir });
      }
    } catch (e) {}
  };
  scan(DELIVERY_DIR, (n) => n.toLowerCase().endsWith('.vcmx'));
  scan(DESKTOP_DIR, (n) => /^su7_(factory_v\d+|car)\.vcmx$/i.test(n));
  out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return out.slice(0, 24);
}

function readLogic() {
  try {
    return readFileSync(join(HERE, 'docs', 'logic.md'), 'utf8');
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------- skill ledger

function envHome() {
  return process.env.USERPROFILE || process.env.HOME || homedir();
}

function dshRootDir() {
  const env = (process.env.VX_DSH_ROOT || process.env.DSH_ROOT || '').trim();
  if (env) return env;
  // Electron exposes ...\resources; the harness lives in resources\app\dsh.
  const rp = process.resourcesPath;
  return rp ? join(rp, 'app', 'dsh') : '';
}

function rootsFor(workspaceRoot) {
  return skillRoots({
    home: envHome(),
    profileDir: process.env.DSH_PROFILE_DIR || '',
    workspaceRoot,
    dshRoot: dshRootDir(),
    pluginDir: HERE,
  });
}

function readSkillsState(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'skills.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

// What an agent session should run to refresh the OpenViking catalog.
const OV_INSTRUCTION = [
  '请帮我刷新 OpenViking 技能目录（一次就够）：',
  '1) 调 openviking 的 tree(uri="viking://~/skills", level_limit=1, include_abstract=true)；',
  '2) 再调 tree(uri="viking://agent/skills", level_limit=1, include_abstract=true)；',
  '3) 把两份结果整理成下面这个 JSON，POST 到 http://127.0.0.1:63536/vxwb ：',
  '{"action":"ov-ingest","roots":{"viking://~/skills":[{"name":"技能名","description":"一句话"}],"viking://agent/skills":[]}}',
  '只填 name 和 description 就够，不要贴正文，省 token。',
].join('\n');

function groupOvByRoot(skills) {
  const roots = {};
  for (const s of skills || []) {
    const rootUri = s.rootUri || OV_ROOTS[0];
    if (!roots[rootUri]) roots[rootUri] = [];
    roots[rootUri].push({ name: s.name, description: s.description, uri: s.uri });
  }
  return roots;
}

// Direct MCP call first (works with the server up and no agent in the loop),
// then the agent-pushed snapshot. A dead/absent server is a normal state.
async function collectOv(dir) {
  const cfg = readOvConfig({ home: envHome() });
  const live = await fetchOvSkills(cfg, { timeoutMs: 6000 });
  if (live.ok) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(
        snapshotPath(dir),
        JSON.stringify(
          { capturedAt: new Date().toISOString(), capturedBy: 'vx-workbench:direct', roots: groupOvByRoot(live.skills) },
          null,
          2
        ),
        'utf8'
      );
    } catch (e) {}
    return {
      status: 'live',
      baseUrl: cfg.baseUrl,
      capturedAt: new Date().toISOString(),
      skills: live.skills,
      transport: 'mcp-http',
      error: live.error || '',
      instruction: OV_INSTRUCTION,
    };
  }
  const snap = readSnapshot(snapshotPath(dir));
  if (snap && snap.skills && snap.skills.length) {
    return {
      status: 'snapshot',
      baseUrl: cfg.baseUrl,
      capturedAt: snap.capturedAt,
      skills: snap.skills,
      transport: 'snapshot',
      error: live.error || (snap.error || ''),
      instruction: OV_INSTRUCTION,
    };
  }
  return {
    status: live.status || 'unavailable',
    baseUrl: cfg.baseUrl,
    capturedAt: null,
    skills: [],
    transport: 'none',
    error: live.error || '',
    instruction: OV_INSTRUCTION,
  };
}

// Scan every skill root, diff against the previous scan, rewrite the knowledge
// ledger (docs/skills.md), and return the new state. Cheap enough to run on a timer.
async function scanAndPersist(ctx, opts) {
  const workspaceRoot = resolveRoot(ctx);
  const dir = join(workspaceRoot, DATA_DIR);
  const prev = readSkillsState(dir);
  const roots = rootsFor(workspaceRoot);
  const scan = scanSkills(roots, { pluginSkillsRoot: join(HERE, 'skills') });
  const ov = await collectOv(dir);
  const merged = scan.skills.concat(ov.skills || []);
  const ignoredNames = readIgnore(dir);
  const ignoredSet = new Set(ignoredNames.map((n) => n.toLowerCase()));
  for (const s of merged) s.ignored = ignoredSet.has(String(s.name || '').toLowerCase());
  const diff = diffSkills(prev && prev.skills, merged);
  const autoNotify =
    opts && typeof opts.autoNotify === 'boolean' ? opts.autoNotify : !!(prev && prev.autoNotify === true);

  const state = {
    scannedAt: new Date().toISOString(),
    workspaceRoot,
    count: merged.length,
    digest: diff.digest,
    roots: roots.map((r) => ({ root: r, present: existsSync(r) })),
    skills: merged,
    errors: scan.errors,
    ov: {
      status: ov.status,
      baseUrl: ov.baseUrl,
      capturedAt: ov.capturedAt,
      count: (ov.skills || []).length,
      transport: ov.transport,
      error: ov.error || '',
      roots: OV_ROOTS,
      instruction: OV_INSTRUCTION,
    },
    diff: {
      initial: diff.initial,
      at: new Date().toISOString(),
      added: diff.added.map(labelOf),
      changed: diff.changed.map(labelOf),
      removed: diff.removed.map(labelOf),
    },
    ledgerPath: join(HERE, 'docs', 'skills.md'),
    autoNotify,
    ignored: {
      count: merged.filter((s) => s.ignored).length,
      names: ignoredNames,
    },
    deleteRequests: pendingRequests(dir).map((r) => ({ id: r.id, name: r.name, reason: r.reason, at: r.at })),
  };

  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'skills.json'), JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {}

  try {
    const view = { workspaceRoot, home: envHome(), profileDir: process.env.DSH_PROFILE_DIR || '', dshRoot: dshRootDir() };
    writeFileSync(state.ledgerPath, renderLedger(state, view), 'utf8');
  } catch (e) {}

  const touched = diff.added.length + diff.changed.length + diff.removed.length;
  if (touched > 0) {
    const marks = []
      .concat(
        diff.added.map((s) => '+' + labelOf(s)),
        diff.changed.map((s) => '~' + labelOf(s)),
        diff.removed.map((s) => '-' + labelOf(s))
      )
      .join(' ');
    appendJsonl(dir, 'log.jsonl', {
      at: state.scannedAt,
      kind: 'skills-diff',
      text: '技能台账更新：+' + diff.added.length + ' ~' + diff.changed.length + ' -' + diff.removed.length + ' · ' + marks,
    });
  }
  return state;
}

// One compact prompt that tells a session what changed and where the ledger is.
function skillsNotice(s) {
  const d = (s && s.diff) || {};
  const added = d.added || [];
  const changed = d.changed || [];
  const removed = d.removed || [];
  const rows = ((s && s.skills) || []).slice(0, 40).map((x) => '- ' + x.name + '：' + (x.description || '').slice(0, 90));
  const head =
    '【工作站知识自动更新 · 技能台账】\n' +
    'vx-workbench 扫描到技能变化：新增 ' + added.length + ' / 变更 ' + changed.length + ' / 移除 ' + removed.length +
    '（共 ' + ((s && s.count) || 0) + ' 个技能 · 其中 OpenViking ' + (((s && s.ov) || {}).count || 0) + ' 个）。\n' +
    '台账已重写：' + ((s && s.ledgerPath) || 'plugins/vx-workbench/docs/skills.md') + '\n' +
    (added.length ? '新增：' + added.join('、') + '\n' : '') +
    (changed.length ? '变更：' + changed.join('、') + '\n' : '') +
    (removed.length ? '移除：' + removed.join('、') + '\n' : '');
  const tail =
    '\n当前技能清单（只做索引，正文以各自 SKILL.md 为准）：\n' + rows.join('\n') +
    '\n\n请把新技能纳入你手上的工作站任务；需要正文时直接 read 该目录下的 SKILL.md，不要凭记忆猜技能名。';
  return (head + tail).slice(0, 3500);
}

// ---------------------------------------------------------------- skill governance
// Sessions may propose knowledge, but they may not silently delete it:
//   add / update  -> written into the plugin's own skills/ with a backup
//   delete        -> queued as a request; only the operator resolves it
//   irrelevant    -> ignored (hidden from the ledger), never physically removed
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

const ignorePath = (dir) => join(dir, 'skill-ignore.json');
const requestsPath = (dir) => join(dir, 'skill-requests.jsonl');
const backupDir = (dir) => join(dir, 'backup', 'skills');
const trashDir = (dir) => join(dir, 'trash', 'skills');

function readIgnore(dir) {
  try {
    const j = JSON.parse(readFileSync(ignorePath(dir), 'utf8'));
    return Array.isArray(j && j.names) ? j.names.map(String) : [];
  } catch (e) {
    return [];
  }
}

function writeIgnore(dir, names) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const clean = Array.from(new Set((names || []).map((n) => String(n).trim()).filter(Boolean))).sort();
  writeFileSync(ignorePath(dir), JSON.stringify({ updatedAt: new Date().toISOString(), names: clean }, null, 2), 'utf8');
  return clean;
}

// Pending delete requests = ids whose latest record has no decision yet.
function pendingRequests(dir) {
  const rows = readJsonl(requestsPath(dir), 400);
  const byId = new Map();
  for (const r of rows) {
    if (!r || !r.id) continue;
    const prev = byId.get(r.id);
    if (!prev) byId.set(r.id, r);
    else if (r.decision) byId.set(r.id, { ...prev, decision: r.decision, decidedAt: r.at });
  }
  return Array.from(byId.values()).filter((r) => !r.decision);
}

function skillFilePath(name) {
  return join(HERE, 'skills', name, 'SKILL.md');
}

function composeSkill(name, description, body) {
  const clean = String(body || '').replace(/\r\n/g, '\n').trim();
  return ['---', 'name: ' + name, 'description: ' + String(description || '').replace(/\n/g, ' ').trim(), '---', '', clean, ''].join('\n');
}

function validateSkill(name, description, body) {
  if (!SKILL_NAME_RE.test(String(name || ''))) return '技能名要小写字母/数字/连字符，2-63 字符（例如 vx-new-trick）';
  const d = String(description || '').trim();
  if (d.length < 20 || d.length > 400) return 'description 要 20-400 字符，写清「什么时候用」';
  if (String(body || '').trim().length < 80) return '正文太短（至少 80 字符）——只写踩过的具体操作，不写空话';
  return '';
}

function targetable(items) {
  return (items || []).filter((i) => i && i.origin !== 'subagent' && i.blank !== true);
}

function pickTargets(items, opts) {
  const now = Date.now();
  let list = targetable(items);
  const ids = Array.isArray(opts && opts.ids) ? opts.ids.map(String) : [];
  if (ids.length) {
    const want = new Set(ids);
    list = list.filter((i) => want.has(String(i.sessionId)));
  } else {
    const hours = Number(opts && opts.maxAgeHours);
    if (Number.isFinite(hours) && hours > 0) list = list.filter((i) => now - (i.updatedAt || 0) <= hours * 3600e3);
    if (opts && opts.onlyRunning === true) list = list.filter((i) => i.running === true);
  }
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Which conversations would a fan-out touch? Read-only.
async function listTargets(ctx, opts) {
  const sc = ctx.get('sessionController');
  if (!sc || typeof sc.list !== 'function') return { ok: false, error: 'sessionController 不可用' };
  let items = [];
  try {
    const page = await sc.list({}, AbortSignal.timeout(8000));
    items = (page && page.items) || [];
  } catch (e) {
    return { ok: false, error: '读取会话列表失败：' + errText(e) };
  }
  const picked = pickTargets(items, opts);
  const cap = Math.max(1, Math.min(Number((opts && opts.cap) || BROADCAST_CAP), 120));
  return {
    ok: true,
    dryRun: true,
    visible: targetable(items).length,
    total: picked.length,
    truncated: picked.length > cap,
    targets: picked.slice(0, cap).map((i) => ({
      sessionId: String(i.sessionId),
      running: i.running === true,
      updatedAt: i.updatedAt || 0,
      cwd: i.cwd || '',
    })),
  };
}

// Push one prompt into every selected existing session as a queued user message.
// mode=queue: a busy session picks it up after the current turn; an idle one starts a turn.
async function broadcastAll(ctx, text, opts) {
  const pre = await listTargets(ctx, opts);
  if (!pre.ok) return pre;
  if (opts && opts.dryRun === true) return { ...pre, note: '预览：' + pre.total + ' 个目标（未发送）' };

  const sc = ctx.get('sessionController');
  const results = [];
  for (const t of pre.targets) {
    const requestId = 'vxskills-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    try {
      await sc.prompt(
        {
          requestId,
          sessionId: t.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
          clientTimeZone: 'Asia/Shanghai',
        },
        AbortSignal.timeout(20000)
      );
      results.push({ sessionId: t.sessionId, ok: true });
    } catch (e) {
      results.push({ sessionId: t.sessionId, ok: false, error: errText(e) });
    }
  }
  return {
    ok: true,
    dryRun: false,
    visible: pre.visible,
    total: pre.total,
    truncated: pre.truncated,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    results,
  };
}

// Compact handoff so a brand-new conversation can start working immediately
// instead of re-learning this project from zero.
function buildHandoff(st) {
  const d = st.dll || {};
  const sn = st.strongName || {};
  const names = (st.layouts || []).map((l) => l.name).join(', ') || '（无）';
  return [
    '【交接简报 · 自动生成，供新会话直接接手】',
    '工作目录：' + (st.dataDir || '').replace(/\\vx-workbench$/, ''),
    '数据目录：' + (st.dataDir || '') + '（status.json / requests.jsonl / log.jsonl，可直接用 node 读）',
    '破解包：' + (st.crackDir || '') + '（install.ps1 / restore.ps1，安装需管理员 + UAC）',
    '补丁现状：dll=' + d.state + ' byte=' + d.byte + ' | 强名称免验证=' + sn.verificationRegistered + ' | AllowStrongNameBypass=' + sn.allowBypassSet,
    '厂房资产：' + names,
    '技能台账：' + (st.skills ? st.skills.count + ' 个技能（digest ' + String(st.skills.digest || '').slice(0, 8) + '）→ ' + st.skills.ledgerPath : '（尚未扫描，面板点“立即扫描”）'),
    'OpenViking 技能：' + (st.skills && st.skills.ov ? (st.skills.ov.count || 0) + ' 个（状态 ' + st.skills.ov.status + '）' : '（未知）') +
      '；抓取/刷新流程见台账文件末尾',
    '（技能台账每 5 分钟自动重扫；新装技能会自动写进去。查技能先读台账，再 read 对应目录的 SKILL.md，别凭记忆猜名字）',
    '',
    '关键事实（别重复踩坑）：',
    '1) 补丁对象 VisualComponents.HOOPS.dll，偏移 173095 处 75 19→EB 19（Reader::Import 的授权判定跳转）。',
    '   必须同时：清 COMIMAGE_FLAGS_STRONGNAMESIGNED 与签名块；注册 HKLM\\SOFTWARE\\Microsoft\\StrongName\\Verification\\VisualComponents.HOOPS,31bc53bc7503b77a；',
    '   设 HKLM\\SOFTWARE\\Microsoft\\.NETFramework\\AllowStrongNameBypass=1。否则 CLR 报 0x8013141A，表现为「不报错也不生成」。',
    '2) 车间改造走 Python 桥 queue（C:\\Users\\lenovo\\Documents\\HANDI\\4.8\\My Commands\\su7line\\queue），队列仅在启动时执行，一批=一次重启；',
    '   app.load 是合并语义不是替换；>30MB 直接用 CLI 打开会卡死；app.save 只能写新文件名，覆盖写走 GUI Ctrl+S→另存为。',
    '3) 模型单位：VC 用 mm/Z-up，GLB/FBX 是米/Y-up → Blender 里整体 ×1000、axis_up=\'Z\' 导出（脚本 C:\\Users\\lenovo\\Desktop\\fbx_test\\fix_su7.py）。',
    '4) 完整分析与待办见：plugins/vx-workbench/docs/logic.md（面板「破解逻辑 · 工作逻辑」里也能展开看）。',
  ].join('\n');
}

// Push one text prompt into the most relevant live session as a real user message.
// toNew=true creates a fresh Session that inherits the reference Session's agent preset
// (same tools / skills / system prompt) and cwd, then prepends a handoff brief so the new
// conversation starts fully capable with no re-training.
async function pushPrompt(ctx, text, toNew, handoff) {
  const sc = ctx.get('sessionController');
  if (!sc || typeof sc.prompt !== 'function') return { ok: false, error: 'sessionController 不可用' };
  let items = [];
  try {
    const page = await sc.list({}, AbortSignal.timeout(6000));
    items = (page && page.items) || [];
  } catch (e) {
    return { ok: false, error: '读取会话列表失败：' + errText(e) };
  }
  const cands = items.filter((i) => i && i.origin !== 'subagent');
  const running = cands.filter((i) => i.running).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const ref = running[0] || cands.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];

  let sessionId;
  let created = false;
  let preset;
  let body = text;

  if (toNew === true) {
    if (typeof sc.create !== 'function') return { ok: false, error: 'sessionController.create 不可用' };
    // Inherit the reference Session's agent preset so the new chat has identical capability.
    if (ref && typeof sc.inspect === 'function') {
      try {
        const insp = await sc.inspect(ref.sessionId, AbortSignal.timeout(6000));
        preset = insp && insp.meta ? insp.meta.agentPreset : undefined;
      } catch (e) {}
    }
    const req = {};
    if (ref && ref.cwd) req.cwd = ref.cwd;
    if (preset) req.agentPreset = preset;
    try {
      const made = await sc.create(req);
      sessionId = made && made.sessionId;
      created = true;
      if (!sessionId) return { ok: false, error: '新建会话未返回 id' };
    } catch (e) {
      return { ok: false, error: '新建会话失败：' + errText(e) };
    }
    if (handoff) body = handoff + '\n\n==== 以下是我这次的需求 ====\n' + text;
  } else {
    if (!ref) return { ok: false, error: '没有可发送的会话' };
    sessionId = ref.sessionId;
  }

  const requestId = 'vxwb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  try {
    await sc.prompt(
      {
        requestId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: body }],
        clientTimeZone: 'Asia/Shanghai',
      },
      AbortSignal.timeout(15000)
    );
    return { ok: true, sessionId, created, preset: preset || null };
  } catch (e) {
    return { ok: false, error: errText(e), sessionId, created, preset: preset || null };
  }
}

async function collectStatus(ctx) {
  const dir = join(resolveRoot(ctx), DATA_DIR);
  const inf = inspectDll();

  const regVer = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\StrongName\\Verification\\' + ASM_KEY]);
  const regBypass = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\.NETFramework', '/v', 'AllowStrongNameBypass']);
  const procs = await run('tasklist', ['/FI', 'IMAGENAME eq VisualComponents.Engine.exe', '/FO', 'CSV', '/NH']);

  const backupPath = join(CRACK_DIR, 'backup_原版\\VisualComponents.HOOPS.dll');

  const status = {
    generatedAt: new Date().toISOString(),
    dataDir: dir,
    installDir: INSTALL_DIR,
    crackDir: CRACK_DIR,
    deliveryDir: DELIVERY_DIR,
    dll: {
      path: HOOPS_DLL,
      present: inf.exists,
      state: inf.exists ? inf.state : 'unknown',
      byte: inf.exists && inf.byte != null ? '0x' + inf.byte.toString(16).toUpperCase() : null,
      offset: inf.offset != null ? inf.offset : PATCH_OFFSET,
      sites: inf.sites || 0,
      action: inf.action || '',
      reason: inf.reason || inf.error || '',
      size: inf.size || null,
      sha256: inf.sha256 || sha256(HOOPS_DLL),
      mtime: statOf(HOOPS_DLL) ? statOf(HOOPS_DLL).mtime : null,
    },
    strongName: {
      assembly: ASM_KEY,
      verificationRegistered: regVer.code === 0,
      allowBypassSet: regBypass.code === 0 && /0x1\b|\b1\b/.test(regBypass.out),
    },
    backup: { path: backupPath, present: existsSync(backupPath) },
    process: {
      running: /VisualComponents\.Engine\.exe/i.test(procs.out),
      detail: procs.out.trim().slice(0, 200),
    },
    layouts: listLayouts(),
    log: readJsonl(join(dir, 'log.jsonl'), 25),
    requests: readJsonl(join(dir, 'requests.jsonl'), 12),
    logic: readLogic(),
    skills: (() => {
      const sk = readSkillsState(dir);
      if (!sk) return null;
      const d = sk.diff || {};
      return {
        count: sk.count || 0,
        digest: sk.digest || '',
        scannedAt: sk.scannedAt || '',
        added: d.added || [],
        changed: d.changed || [],
        removed: d.removed || [],
        initial: d.initial === true,
        autoNotify: sk.autoNotify === true,
        ledgerPath: sk.ledgerPath || '',
        watched: (sk.roots || []).length,
        ov: sk.ov || null,
        list: (sk.skills || []).slice(0, 80).map((s) => ({
          name: s.name,
          desc: String(s.description || '').slice(0, 130),
          root: s.root || s.rootUri || '',
          source: s.source || 'fs',
          scope: s.scope || 'other',
          ignored: s.ignored === true,
          fp: String(s.fingerprint || '').slice(0, 8),
        })),
        vxCount: (sk.skills || []).filter((s) => s.scope === 'vx' && !s.ignored).length,
        otherCount: (sk.skills || []).filter((s) => s.scope !== 'vx' && !s.ignored).length,
        ignoredCount: (sk.ignored && sk.ignored.count) || 0,
        pending: sk.deleteRequests || [],
      };
    })(),
  };

  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  } catch (e) {}
  return status;
}

function appendJsonl(dir, file, entry) {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, file), JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {}
}

export function apply(ctx) {
  const dirOf = () => join(resolveRoot(ctx), DATA_DIR);
  const send = (res, code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };
  const body = (req) =>
    new Promise((ok, bad) => {
      const c = [];
      let n = 0;
      req.on('data', (x) => {
        n += x.length;
        if (n > 262144) {
          bad(new Error('too large'));
          req.destroy();
          return;
        }
        c.push(x);
      });
      req.on('end', () => ok(Buffer.concat(c).toString('utf8')));
      req.on('error', bad);
    });

  const spawnPs = (scriptFile) => {
    try {
      const child = execFile(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(CRACK_DIR, scriptFile)],
        { windowsHide: false, detached: true },
        () => {}
      );
      child.unref();
      return true;
    } catch (e) {
      return false;
    }
  };

  const openPath = (path, select) => {
    try {
      const child = select
        ? execFile('explorer.exe', ['/select,', path], { windowsHide: false, detached: true }, () => {})
        : execFile('explorer.exe', [path], { windowsHide: false, detached: true }, () => {});
      child.unref();
      return true;
    } catch (e) {
      return false;
    }
  };

  // Auto-iterating knowledge: rescan skill roots on a timer, rewrite the ledger,
  // and (only when the user turned it on) notify every conversation about a change.
  ctx.effect(() => {
    let stopped = false;
    const kick = async () => {
      if (stopped) return;
      try {
        const s = await scanAndPersist(ctx);
        const touched = s.diff.added.length + s.diff.changed.length + s.diff.removed.length;
        if (s.autoNotify && touched > 0) {
          const out = await broadcastAll(ctx, skillsNotice(s), { maxAgeHours: 0 });
          appendJsonl(dirOf(), 'log.jsonl', {
            at: new Date().toISOString(),
            kind: 'skills-notify',
            text: '自动通知 → 送达 ' + (out.sent || 0) + '/' + (out.total || 0),
          });
        }
      } catch (e) {}
    };
    const first = setTimeout(kick, 2000);
    const timer = setInterval(kick, SKILL_SCAN_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, 'vx-workbench: skill ledger watch');

  ctx.effect(() => {
    const off = ctx.webServer.register({
      kind: 'exact',
      path: '/vxwb',
      handler: async (req, res) => {
        const dir = dirOf();
        try {
          if (req.method === 'GET') {
            return send(res, 200, { ok: true, status: await collectStatus(ctx) });
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return undefined;
          }

          const msg = JSON.parse((await body(req)) || '{}');
          const action = String(msg.action || '');

          if (action === 'install' || action === 'restore') {
            const script = action === 'install' ? 'install.ps1' : 'restore.ps1';
            if (!existsSync(join(CRACK_DIR, script))) return send(res, 400, { ok: false, error: '找不到 ' + script });
            const launched = spawnPs(script);
            appendJsonl(dir, 'log.jsonl', {
              at: new Date().toISOString(),
              kind: action,
              text: launched ? '已启动 ' + script + '（等待 UAC 确认）' : '启动失败 ' + script,
            });
            return send(res, 200, { ok: launched, launched: script, note: '会弹出 UAC，请点“是”' });
          }

          if (action === 'open-install') return send(res, 200, { ok: openPath(INSTALL_DIR) });
          if (action === 'open-crack') return send(res, 200, { ok: openPath(CRACK_DIR) });
          if (action === 'open-delivery') return send(res, 200, { ok: openPath(DELIVERY_DIR) });

          if (action === 'open-file') {
            const name = String(msg.name || '');
            if (!name || name.indexOf('..') >= 0 || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) {
              return send(res, 400, { ok: false, error: '非法文件名' });
            }
            const hit = listLayouts().find((x) => x.name === name);
            if (!hit) return send(res, 404, { ok: false, error: '未找到该布局' });
            const okOpen = openPath(hit.path, true);
            appendJsonl(dir, 'log.jsonl', { at: new Date().toISOString(), kind: 'open-file', text: hit.name });
            return send(res, 200, { ok: okOpen, path: hit.path });
          }

          if (action === 'log') {
            const text = String(msg.text || '').slice(0, 2000).trim();
            if (!text) return send(res, 400, { ok: false, error: '内容为空' });
            appendJsonl(dir, 'log.jsonl', { at: new Date().toISOString(), kind: 'note', text });
            return send(res, 200, { ok: true, dir });
          }

          // The ask channel: a real user message into the live session (or a fresh one).
          if (action === 'ask') {
            const text = String(msg.text || '').slice(0, 4000).trim();
            if (!text) return send(res, 400, { ok: false, error: '请先写需求' });
            const toNew = msg.newSession === true;
            const at = new Date().toISOString();
            let handoff = '';
            if (toNew) {
              try {
                handoff = buildHandoff(await collectStatus(ctx));
                if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'handoff.md'), handoff, 'utf8');
              } catch (e) {
                handoff = '';
              }
            }
            appendJsonl(dir, 'requests.jsonl', { at, text, status: 'sending', target: toNew ? 'new' : 'current' });
            const out = await pushPrompt(ctx, text, toNew, handoff);
            const where = out.created ? '新对话' : '当前对话';
            appendJsonl(dir, 'requests.jsonl', {
              at: new Date().toISOString(),
              text: out.ok
                ? '↳ 已送入' + where + ' ' + (out.sessionId || '') + (out.preset ? '（preset=' + out.preset + '）' : '')
                : '↳ 发送失败：' + out.error,
              status: out.ok ? 'sent' : 'failed',
              target: toNew ? 'new' : 'current',
              sessionId: out.sessionId || null,
              preset: out.preset || null,
            });
            appendJsonl(dir, 'log.jsonl', {
              at,
              kind: out.ok ? (out.created ? 'ask-new-chat' : 'ask-sent') : 'ask-failed',
              text: out.ok ? '[' + where + '] ' + text.slice(0, 200) : text.slice(0, 120) + ' → ' + out.error,
            });
            return send(res, out.ok ? 200 : 502, {
              ok: out.ok,
              sessionId: out.sessionId,
              created: out.created === true,
              preset: out.preset || null,
              handoffBytes: handoff ? handoff.length : 0,
              error: out.error,
              note: out.ok
                ? out.created
                  ? '已新建对话（同 preset + 交接简报）并发送，切到那边继续'
                  : '已作为一条用户消息发到当前对话，agent 立刻开始处理'
                : '没能送进会话：' + out.error,
            });
          }

          // Read back what the target Session last said (reply receipt for an ask).
          if (action === 'tail') {
            const id = String(msg.sessionId || '');
            if (!/^session-[0-9a-zA-Z-]{8,}$/.test(id)) return send(res, 400, { ok: false, error: '非法 sessionId' });
            const sc = ctx.get('sessionController');
            if (!sc || typeof sc.inspect !== 'function') return send(res, 400, { ok: false, error: 'sessionController 不可用' });
            let evs = [];
            try {
              const insp = await sc.inspect(id, AbortSignal.timeout(10000));
              evs = (insp && insp.events) || [];
            } catch (e) {
              return send(res, 502, { ok: false, error: '读取会话失败：' + errText(e) });
            }
            const asst = [];
            let userText = '';
            for (const ev of evs) {
              const d = ev.data || {};
              const m = d.message || d;
              const txt = ((m && m.content) || [])
                .filter((b) => b && b.type === 'text')
                .map((b) => b.text)
                .join(' ')
                .trim();
              if (!txt) continue;
              if (ev.type === 'user/message') userText = userText || txt;
              else if (ev.type === 'assistant/message') asst.push(txt);
            }
            return send(res, 200, {
              ok: true,
              sessionId: id,
              replies: asst.length,
              userText: userText.slice(0, 300),
              last: (asst[asst.length - 1] || '').slice(0, 1600),
            });
          }

          // ---- skill ledger: scan now / toggle auto-notify / open the knowledge doc
          if (action === 'skills-scan') {
            const s = await scanAndPersist(ctx);
            return send(res, 200, {
              ok: true,
              count: s.count,
              digest: s.digest,
              added: s.diff.added,
              changed: s.diff.changed,
              removed: s.diff.removed,
              ledger: s.ledgerPath,
              scannedAt: s.scannedAt,
              note:
                '扫描完成：' + s.count + ' 个技能（+' + s.diff.added.length + ' ~' + s.diff.changed.length + ' -' + s.diff.removed.length + '）',
            });
          }

          if (action === 'skills-settings') {
            const autoNotify = msg.autoNotify === true;
            const s = await scanAndPersist(ctx, { autoNotify });
            appendJsonl(dir, 'log.jsonl', {
              at: new Date().toISOString(),
              kind: 'skills-settings',
              text: 'autoNotify=' + autoNotify,
            });
            return send(res, 200, {
              ok: true,
              autoNotify: s.autoNotify,
              note: autoNotify ? '已开启：检测到技能变化时自动通知所有会话' : '已关闭自动通知（台账照旧自动更新）',
            });
          }

          if (action === 'open-doc') {
            const name = String(msg.name || 'skills.md');
            if (!/^(skills|logic)\.md$/.test(name)) return send(res, 400, { ok: false, error: '只允许 skills.md / logic.md' });
            const p = join(HERE, 'docs', name);
            return send(res, 200, { ok: openPath(p), path: p });
          }

          // ---- OpenViking catalog: accept an agent-pushed snapshot / probe directly
          if (action === 'ov-ingest') {
            const payload = msg.data && typeof msg.data === 'object' ? msg.data : msg;
            const normalized = normalizeIngest(payload);
            const rootCount = Object.values(normalized.roots).reduce((n, list) => n + list.length, 0);
            if (rootCount === 0) {
              return send(res, 400, { ok: false, error: '没有可用的 roots/entries（需要 [{name, description}]）' });
            }
            try {
              if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
              writeFileSync(snapshotPath(dir), JSON.stringify(normalized, null, 2), 'utf8');
            } catch (e) {
              return send(res, 500, { ok: false, error: '写入快照失败：' + errText(e) });
            }
            const s = await scanAndPersist(ctx);
            const ovCount = (s.ov && s.ov.count) || 0;
            appendJsonl(dir, 'log.jsonl', {
              at: new Date().toISOString(),
              kind: 'ov-ingest',
              text: 'OpenViking 快照写入 ' + rootCount + ' 条 · 台账现有 ' + ovCount + ' 个 ov 技能',
            });
            return send(res, 200, {
              ok: true,
              entries: rootCount,
              ovCount,
              status: (s.ov || {}).status,
              capturedAt: normalized.capturedAt,
              note: 'OpenViking 目录已收下：' + rootCount + ' 条（台账共 ' + s.count + ' 个技能）',
            });
          }

          if (action === 'ov-check') {
            const s = await scanAndPersist(ctx);
            const ovs = s.ov || {};
            return send(res, 200, {
              ok: true,
              ov: ovs,
              note:
                'OpenViking：' + ovs.status + (ovs.count ? ' · ' + ovs.count + ' 个技能' : '') + (ovs.error ? ' · ' + ovs.error : ''),
            });
          }

          // ---- skill governance: sessions may add knowledge, never silently delete it
          if (action === 'skill-add' || action === 'skill-update') {
            const name = String(msg.name || '').trim();
            const isUpdate = action === 'skill-update';
            const file = skillFilePath(name);
            const exists = existsSync(file);
            if (!SKILL_NAME_RE.test(name)) {
              return send(res, 400, { ok: false, error: '技能名要小写字母/数字/连字符，2-63 字符，例如 vx-new-trick' });
            }
            if (isUpdate && !exists) return send(res, 404, { ok: false, error: '技能不存在：' + name });
            if (!isUpdate && exists) return send(res, 409, { ok: false, error: '技能已存在，改用 skill-update：' + name });
            const description = String(msg.description || '');
            const body = String(msg.body || msg.content || '');
            const bad = validateSkill(name, description, body);
            if (bad) return send(res, 400, { ok: false, error: bad });
            if (exists) {
              try {
                if (!existsSync(backupDir(dir))) mkdirSync(backupDir(dir), { recursive: true });
                copyFileSync(file, join(backupDir(dir), name + '-' + Date.now() + '.md'));
              } catch (e) {}
            }
            try {
              mkdirSync(join(HERE, 'skills', name), { recursive: true });
              writeFileSync(file, composeSkill(name, description, body), 'utf8');
            } catch (e) {
              return send(res, 500, { ok: false, error: '写入失败：' + errText(e) });
            }
            const s = await scanAndPersist(ctx);
            appendJsonl(dir, 'log.jsonl', {
              at: new Date().toISOString(),
              kind: isUpdate ? 'skill-update' : 'skill-add',
              text: name + ' — ' + description.slice(0, 140),
            });
            return send(res, 200, {
              ok: true,
              name,
              path: file,
              vxCount: (s.skills || []).filter((x) => x.scope === 'vx' && !x.ignored).length,
              note: (isUpdate ? '已更新技能：' : '已写入新技能：') + name,
            });
          }

          if (action === 'skill-request-delete') {
            const name = String(msg.name || '').trim();
            const reason = String(msg.reason || '').trim();
            if (!SKILL_NAME_RE.test(name)) return send(res, 400, { ok: false, error: '非法技能名' });
            if (reason.length < 10) return send(res, 400, { ok: false, error: '请写清为什么该删（≥10 字，例如实测报错、已被替代）' });
            const id = 'req-' + Date.now().toString(36);
            appendJsonl(dir, 'skill-requests.jsonl', { id, at: new Date().toISOString(), kind: 'delete', name, reason });
            appendJsonl(dir, 'log.jsonl', {
              at: new Date().toISOString(),
              kind: 'skill-request-delete',
              text: name + ' — ' + reason.slice(0, 120),
            });
            return send(res, 200, { ok: true, id, note: '已提交删除申请，待你在面板批准：' + name });
          }

          if (action === 'skill-resolve') {
            const id = String(msg.id || '');
            const decision = String(msg.decision || '');
            if (!id || (decision !== 'accept' && decision !== 'reject')) {
              return send(res, 400, { ok: false, error: '需要 id 与 decision=accept|reject' });
            }
            const pending = pendingRequests(dir).find((r) => r.id === id);
            if (!pending) return send(res, 404, { ok: false, error: '没有这个待处理申请：' + id });
            if (decision === 'accept') {
              const srcDir = join(HERE, 'skills', pending.name);
              if (existsSync(srcDir)) {
                const dst = join(trashDir(dir), pending.name + '-' + Date.now());
                try {
                  mkdirSync(dirname(dst), { recursive: true });
                  renameSync(srcDir, dst);
                } catch (e) {
                  return send(res, 500, { ok: false, error: '移入回收站失败：' + errText(e) });
                }
              }
            }
            appendJsonl(dir, 'skill-requests.jsonl', { id, at: new Date().toISOString(), decision });
            await scanAndPersist(ctx);
            return send(res, 200, {
              ok: true,
              id,
              decision,
              note: decision === 'accept' ? '已删除并移入回收站：' + pending.name : '已驳回，技能保留：' + pending.name,
            });
          }

          if (action === 'skill-ignore' || action === 'skill-unignore') {
            const names = Array.isArray(msg.names) ? msg.names.map(String) : msg.name ? [String(msg.name)] : [];
            const cur = readIgnore(dir);
            let next;
            if (action === 'skill-ignore') {
              if (msg.all === true) {
                const st = readSkillsState(dir);
                const others = ((st && st.skills) || [])
                  .filter((s) => s.scope !== 'vx' && (s.source || 'fs') === 'fs')
                  .map((s) => s.name);
                next = cur.concat(others);
              } else {
                next = cur.concat(names);
              }
            } else if (msg.all === true) {
              next = [];
            } else {
              const drop = new Set(names.map((n) => n.toLowerCase()));
              next = cur.filter((n) => !drop.has(n.toLowerCase()));
            }
            const saved = writeIgnore(dir, next);
            await scanAndPersist(ctx);
            appendJsonl(dir, 'log.jsonl', {
              at: new Date().toISOString(),
              kind: action,
              text: '忽略名单现在 ' + saved.length + ' 个',
            });
            return send(res, 200, {
              ok: true,
              ignored: saved,
              count: saved.length,
              note: action === 'skill-ignore' ? '已忽略 ' + saved.length + ' 个无关技能（不删文件，可随时恢复）' : '忽略名单现在 ' + saved.length + ' 个',
            });
          }

          // ---- fan-out: tell already-open conversations about the new knowledge
          if (action === 'sessions') {
            const out = await listTargets(ctx, msg);
            return send(res, out.ok ? 200 : 502, out);
          }

          if (action === 'skills-broadcast' || action === 'broadcast') {
            let text = '';
            if (action === 'broadcast') {
              text = String(msg.text || '').slice(0, 4000).trim();
            } else {
              const s = readSkillsState(dir) || (await scanAndPersist(ctx));
              text = skillsNotice(s);
            }
            if (!text) return send(res, 400, { ok: false, error: '内容为空' });
            const out = await broadcastAll(ctx, text, msg);
            appendJsonl(dir, 'log.jsonl', {
              at: new Date().toISOString(),
              kind: out.ok ? (msg.dryRun === true ? 'broadcast-preview' : 'broadcast') : 'broadcast-failed',
              text: (out.ok ? '目标 ' + out.total + ' · 送达 ' + (out.sent || 0) : '失败 ' + out.error) + ' · ' + text.slice(0, 160),
            });
            if (msg.dryRun === true) return send(res, out.ok ? 200 : 502, out);
            return send(res, out.ok ? 200 : 502, {
              ...out,
              note: out.ok
                ? '已排队送达 ' + out.sent + '/' + out.total + ' 个会话' + (out.truncated ? '（按上限截断）' : '') +
                  (out.failed && out.failed.length ? '，失败 ' + out.failed.length : '')
                : '失败：' + out.error,
            });
          }

          return send(res, 400, { ok: false, error: '未知动作: ' + action });
        } catch (e) {
          return send(res, 500, { ok: false, error: errText(e) });
        }
      },
    });
    return () => off();
  }, 'vx-workbench: routes');
}
