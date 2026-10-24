// OpenViking skill ingest.
//
// viking:// URIs are database paths, not files, so they can never be scanned from
// disk. Two tolerant channels, tried in order:
//
//   1. direct  — read ~/.openviking/ov.conf or ovcli.conf for baseUrl/api_key and
//                speak MCP-over-HTTP to `${baseUrl}/mcp` (initialize + tools/call
//                "tree"). Works with no agent in the loop when the server is up.
//   2. snapshot— vx-workbench/ov-skills.json, a catalog any agent session dumps
//                through `POST /vxwb {action:'ov-ingest'}` after calling the
//                openviking MCP tools. Used when direct is unavailable or thin.
//
// Both are best-effort: a missing server is a normal state, reported as
// `unreachable`, never as an exception.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const SKILL_ROOTS = ['viking://~/skills', 'viking://agent/skills'];
const MAX_ENTRIES = 500;

const errText = (e) => String((e && e.message) || e);

function parseJsonc(text) {
  // ov.conf is JSON in practice; strip // and /* */ comments defensively.
  const stripped = text
    .replace(/^\uFEFF/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  try {
    return JSON.parse(stripped);
  } catch (e) {
    try {
      return JSON.parse(text);
    } catch (e2) {
      return null;
    }
  }
}

function firstString(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return '';
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  for (const v of Object.values(obj)) {
    const got = firstString(v, keys, depth + 1);
    if (got) return got;
  }
  return '';
}

// Resolve where OpenViking lives, without importing the memory plugin.
export function readOvConfig({ home, env = process.env }) {
  const files = [
    env.OPENVIKING_CLI_CONFIG_FILE || join(home, '.openviking', 'ovcli.conf'),
    env.OPENVIKING_CONFIG_FILE || join(home, '.openviking', 'ov.conf'),
  ];
  let conf = null;
  let sourceFile = '';
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const parsed = parseJsonc(readFileSync(file, 'utf8'));
      if (parsed) {
        conf = parsed;
        sourceFile = file;
        break;
      }
    } catch (e) {}
  }

  const envUrl = (env.OPENVIKING_URL || env.OPENVIKING_BASE_URL || '').trim();
  const fileUrl = conf ? firstString(conf, ['url', 'base_url', 'baseUrl', 'endpoint', 'server']) : '';
  let baseUrl = (envUrl || fileUrl || '').replace(/\/+$/, '');
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) baseUrl = 'http://' + baseUrl;
  const apiKey = (env.OPENVIKING_API_KEY || env.OPENVIKING_BEARER_TOKEN || '').trim()
    || (conf ? firstString(conf, ['api_key', 'apiKey', 'token', 'root_api_key', 'bearer_token']) : '');

  return {
    baseUrl,
    apiKey,
    sourceFile,
    configured: Boolean(baseUrl),
    reason: baseUrl ? '' : sourceFile ? '配置文件里没有 url/base_url' : '未找到 ov.conf / ovcli.conf，也没有 OPENVIKING_URL',
  };
}

// Minimal MCP streamable-HTTP client: just enough for initialize + tools/call.
async function mcpPost(url, payload, sessionId, apiKey, timeoutMs) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  if (apiKey) headers.authorization = 'Bearer ' + apiKey;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const nextSession = res.headers.get('mcp-session-id') || sessionId || '';

  if (!res.ok) {
    return { ok: false, status: res.status, error: 'HTTP ' + res.status + ' ' + text.slice(0, 200), session: nextSession };
  }

  // Accept plain JSON and SSE framing alike; take the last data: payload.
  let parsed = null;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {}
  }
  if (!parsed && trimmed.includes('data:')) {
    const frames = trimmed
      .split(/\r?\n\r?\n/)
      .map((block) =>
        block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('')
      )
      .filter(Boolean);
    for (let i = frames.length - 1; i >= 0 && !parsed; i -= 1) {
      try {
        parsed = JSON.parse(frames[i]);
      } catch (e) {}
    }
  }
  if (!parsed) return { ok: false, status: res.status, error: '响应不是 JSON/SSE：' + text.slice(0, 160), session: nextSession };
  if (parsed.error) return { ok: false, status: res.status, error: 'MCP 错误：' + JSON.stringify(parsed.error).slice(0, 200), session: nextSession };
  return { ok: true, json: parsed, session: nextSession };
}

function entryFromNode(node, rootUri) {
  if (!node || typeof node !== 'object') return null;
  const rawName = String(node.name || node.title || node.basename || '').trim();
  if (!rawName) return null;
  const name = rawName.replace(/\/+$/, '').split('/').pop();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return null;
  const desc = String(node.abstract || node.description || node.summary || '').trim().replace(/\s+/g, ' ');
  const uri = String(node.uri || (rootUri + '/' + name + '/')).replace(/\/+$/, '') + '/';
  const updated = Number(node.updated_at || node.updatedAt || node.mtime || 0) || null;
  return {
    name,
    source: 'openviking',
    transport: 'mcp-http',
    uri,
    rootUri,
    description: desc.slice(0, 400),
    mtime: updated ? new Date(updated).toISOString() : null,
    fingerprint: createHash('sha256')
      .update([uri, desc, String(updated || '')].join('\n'))
      .digest('hex')
      .toUpperCase()
      .slice(0, 32),
  };
}

// tree() output may arrive structured or as a rendered catalog. Handle both.
function extractNodes(result) {
  const out = [];
  const structured = result && result.structuredContent;
  if (structured && Array.isArray(structured.entries)) out.push(...structured.entries);
  if (structured && Array.isArray(structured.items)) out.push(...structured.items);
  const content = (result && Array.isArray(result.content)) ? result.content : [];
  for (const block of content) {
    if (!block || block.type !== 'text' || typeof block.text !== 'string') continue;
    const text = block.text;
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        const list = Array.isArray(parsed) ? parsed : parsed.entries || parsed.items || parsed.children || [];
        if (Array.isArray(list)) out.push(...list);
        continue;
      } catch (e) {}
    }
    for (const line of trimmed.split(/\r?\n/)) {
      const m = /^\s*(?:[-*]|\d+\.)?\s*([A-Za-z0-9._-]{1,64})\s*(?:[-—:：]\s*(.*))?$/.exec(line);
      if (!m) continue;
      if (/^(skills?|uri|root|total|count|name|说明|共)$/i.test(m[1])) continue;
      out.push({ name: m[1], description: (m[2] || '').trim() });
    }
  }
  return out;
}

export async function fetchOvSkills(cfg, { timeoutMs = 6000 } = {}) {
  if (!cfg || !cfg.configured) {
    return { ok: false, status: 'unconfigured', error: cfg ? cfg.reason : '未配置', skills: [], transport: 'mcp-http' };
  }
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/mcp';
  try {
    const init = await mcpPost(
      url,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'vx-workbench', version: '0.3.0' },
        },
      },
      '',
      cfg.apiKey,
      timeoutMs
    );
    if (!init.ok) return { ok: false, status: 'unreachable', error: init.error, skills: [], transport: 'mcp-http' };

    await mcpPost(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.session, cfg.apiKey, timeoutMs).catch(() => {});

    const skills = [];
    const errors = [];
    let id = 2;
    for (const rootUri of SKILL_ROOTS) {
      const call = await mcpPost(
        url,
        {
          jsonrpc: '2.0',
          id: id++,
          method: 'tools/call',
          params: { name: 'tree', arguments: { uri: rootUri, level_limit: 1, include_abstract: true } },
        },
        init.session,
        cfg.apiKey,
        timeoutMs
      );
      if (!call.ok) {
        errors.push(rootUri + ': ' + call.error);
        continue;
      }
      const nodes = extractNodes(call.json.result);
      const kept = nodes.map((n) => entryFromNode(n, rootUri)).filter(Boolean);
      if (kept.length === 0) errors.push(rootUri + ': tree 返回里没解析出技能');
      skills.push(...kept);
    }
    if (skills.length === 0) {
      return {
        ok: false,
        status: 'empty',
        error: errors.join('；') || 'tree 未返回技能',
        skills: [],
        transport: 'mcp-http',
      };
    }
    return { ok: true, status: 'live', skills, transport: 'mcp-http', error: errors.join('；') };
  } catch (e) {
    return { ok: false, status: 'unreachable', error: errText(e), skills: [], transport: 'mcp-http' };
  }
}

// ---- snapshot bridge -------------------------------------------------------

export function snapshotPath(dir) {
  return join(dir, 'ov-skills.json');
}

export function readSnapshot(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const skills = [];
    const roots = raw && raw.roots && typeof raw.roots === 'object' ? raw.roots : {};
    for (const [rootUri, list] of Object.entries(roots)) {
      if (!Array.isArray(list)) continue;
      for (const item of list.slice(0, MAX_ENTRIES)) {
        const entry = entryFromNode(item, rootUri);
        if (entry) {
          entry.transport = 'snapshot';
          entry.capturedAt = raw.capturedAt || null;
          skills.push(entry);
        }
      }
    }
    if (Array.isArray(raw && raw.entries)) {
      for (const item of raw.entries.slice(0, MAX_ENTRIES)) {
        const entry = entryFromNode(item, String((raw && raw.uri) || SKILL_ROOTS[0]));
        if (entry) {
          entry.transport = 'snapshot';
          entry.capturedAt = raw.capturedAt || null;
          skills.push(entry);
        }
      }
    }
    return { capturedAt: raw.capturedAt || null, capturedBy: raw.capturedBy || '', skills };
  } catch (e) {
    return { capturedAt: null, capturedBy: '', skills: [], error: errText(e) };
  }
}

// Normalize whatever an agent posted into the snapshot shape.
export function normalizeIngest(payload) {
  const now = new Date().toISOString();
  const out = {
    capturedAt: String((payload && payload.capturedAt) || now),
    capturedBy: String((payload && payload.capturedBy) || 'agent:mcp').slice(0, 120),
    roots: {},
  };
  const roots = (payload && payload.roots) || null;
  if (roots && typeof roots === 'object') {
    for (const [uri, list] of Object.entries(roots)) {
      if (!Array.isArray(list)) continue;
      out.roots[String(uri).slice(0, 200)] = list
        .slice(0, MAX_ENTRIES)
        .map((x) => ({
          name: String((x && x.name) || '').slice(0, 64),
          description: String((x && (x.description || x.abstract || '')) || '').slice(0, 400),
          uri: String((x && x.uri) || '').slice(0, 300),
          updated_at: Number((x && (x.updated_at || x.updatedAt)) || 0) || undefined,
        }))
        .filter((x) => /^[A-Za-z0-9._-]{1,64}$/.test(x.name));
    }
  }
  const flat = (payload && Array.isArray(payload.entries)) ? payload.entries : null;
  if (flat) {
    const uri = String((payload && payload.uri) || SKILL_ROOTS[0]).slice(0, 200);
    out.roots[uri] = (out.roots[uri] || []).concat(
      flat
        .slice(0, MAX_ENTRIES)
        .map((x) => ({
          name: String((x && x.name) || '').slice(0, 64),
          description: String((x && (x.description || x.abstract || '')) || '').slice(0, 400),
          uri: String((x && x.uri) || '').slice(0, 300),
        }))
        .filter((x) => /^[A-Za-z0-9._-]{1,64}$/.test(x.name))
    );
  }
  return out;
}

export const OV_ROOTS = SKILL_ROOTS.slice();
