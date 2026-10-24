// Version-agnostic byte patcher for the Visual X-Space CAD-import compatibility
// layer.
//
// The old approach hard-coded file offset 173095. That offset is a property of
// ONE build. This module locates the decision site by its surrounding machine
// code instead, so a different 4.8 build (or a different install language) is
// found by meaning rather than by address.
//
// The site, in the shipped 4.8 build:
//
//     E8 DB B2 01 00      call   <check>
//     84 C0               test   al, al
//     75 19               jne    +0x19      <-- decision: ne = authorised
//     BA FF FF FF FF      mov    edx, -1
//     48 8D 0D 7B 8B 02 00 lea   rcx, [rip+0x28B7B]
//     FF 15 4D D0 01 00   call   [rip+0x1D04D]
//
// Rewriting the short-jump opcode 75 -> EB makes the branch unconditional, which
// is exactly what offset 173095 held.
//
// Everything here is pure: parse, scan, plan, and only an explicit apply/restore
// touches the filesystem. CLI:
//
//     node lib/patch.mjs scan    <dll>
//     node lib/patch.mjs patch   <dll> [--out <file>] [--backup <file>]
//     node lib/patch.mjs restore <backup> <dll>
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Each signature: the code shape around the decision jump. The jump opcode
// itself is a wildcard so the SAME signature matches both an untouched build
// (75 = jne) and an already-patched one (EB = jmp); the opcode byte is then
// classified separately. Matching only the unpatched form would report a healthy
// install as "unsupported", which is exactly the bug this shape avoids.
export const SIGNATURES = [
  {
    id: 'jump-after-al-test',
    // call rel32; test al,al; <jump> short; mov edx,-1; lea rcx,[rip+rel32]
    hex: 'E8 ?? ?? ?? ?? 84 C0 ?? ?? BA FF FF FF FF 48 8D 0D',
    token: 7,
    note: 'test al,al 后的授权判定跳转（主签名）',
  },
  {
    id: 'jump-after-eax-test',
    // same shape, 32-bit check result
    hex: 'E8 ?? ?? ?? ?? 85 C0 ?? ?? BA FF FF FF FF 48 8D 0D',
    token: 7,
    note: 'test eax,eax 变体',
  },
  {
    id: 'jump-after-al-test-mov-eax',
    // call rel32; test al,al; <jump> short; mov eax,-1; lea rcx,[rip+rel32]
    hex: 'E8 ?? ?? ?? ?? 84 C0 ?? ?? B8 FF FF FF FF 48 8D 0D',
    token: 7,
    note: 'mov eax,-1 变体',
  },
];

const PATCHED_OPCODE = 0xeb;
const ORIGINAL_OPCODE = 0x75;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex').toUpperCase();

export function parsePattern(hex) {
  const tokens = String(hex).trim().split(/\s+/);
  return tokens.map((t) => {
    if (t === '??' || t === '?') return { value: 0, wild: true };
    if (!/^[0-9a-fA-F]{2}$/.test(t)) throw new Error('非法特征码 token: ' + t);
    return { value: parseInt(t, 16), wild: false };
  });
}

// Every occurrence of `pattern` in `buf` (overlapping scan, no early exit).
export function findAll(buf, pattern) {
  const hits = [];
  const len = pattern.length;
  const first = pattern[0];
  for (let i = 0; i + len <= buf.length; i += 1) {
    if (!first.wild && buf[i] !== first.value) continue;
    let ok = true;
    for (let j = 1; j < len; j += 1) {
      if (pattern[j].wild) continue;
      if (buf[i + j] !== pattern[j].value) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(i);
  }
  return hits;
}

// Locate the decision site. `buffer` is the whole file.
export function scan(buffer) {
  const perSignature = [];
  for (const sig of SIGNATURES) {
    const pattern = parsePattern(sig.hex);
    const hits = findAll(buffer, pattern);
    perSignature.push({
      id: sig.id,
      note: sig.note,
      hits,
      sites: hits.map((start) => ({
        patternStart: start,
        opcodeOffset: start + sig.token,
        opcode: buffer[start + sig.token],
        state:
          buffer[start + sig.token] === PATCHED_OPCODE
            ? 'patched'
            : buffer[start + sig.token] === ORIGINAL_OPCODE
              ? 'original'
              : 'unexpected',
      })),
    });
  }
  const all = perSignature.flatMap((s) => s.sites);
  return {
    bytes: buffer.length,
    sha256: sha256(buffer),
    signatureResults: perSignature,
    sites: all,
    state: all.length === 0 ? 'unknown' : all.every((s) => s.state === 'patched') ? 'patched' : all.some((s) => s.state === 'original') ? 'original' : 'unknown',
  };
}

// Decide what a patch run would do. Never writes.
export function plan(buffer) {
  const result = scan(buffer);
  if (result.sites.length === 0) {
    return {
      ...result,
      action: 'unsupported',
      reason: '此版本未命中任何特征码（可能不是 Visual X-Space 4.8，或该 build 已重排代码）',
    };
  }
  const originals = result.sites.filter((s) => s.state === 'original');
  const patched = result.sites.filter((s) => s.state === 'patched');
  if (originals.length === 0 && patched.length > 0) {
    return { ...result, action: 'already', reason: '已经打过补丁（opcode = EB）', target: patched[0] };
  }
  if (originals.length === 1) {
    return { ...result, action: 'patch', reason: '唯一命中，可安全打补丁', target: originals[0] };
  }
  if (originals.length > 1) {
    return {
      ...result,
      action: 'ambiguous',
      reason: '命中 ' + originals.length + ' 处候选，需要人工指定 opcodeOffset',
      candidates: originals.map((s) => s.opcodeOffset),
    };
  }
  return { ...result, action: 'unsupported', reason: '命中位置 opcode 既不是 75 也不是 EB' };
}

export function applyPatch(buffer, target) {
  const out = Buffer.from(buffer);
  out[target.opcodeOffset] = PATCHED_OPCODE;
  return out;
}

export function restoreBytes(buffer, target) {
  const out = Buffer.from(buffer);
  out[target.opcodeOffset] = ORIGINAL_OPCODE;
  return out;
}

// ---- filesystem operations (explicit, with backup + read-back verification)

export function patchFile(file, { out, backup } = {}) {
  if (!existsSync(file)) return { ok: false, error: '找不到文件：' + file };
  const before = readFileSync(file);
  const decision = plan(before);
  if (decision.action === 'already') {
    return { ok: true, changed: false, decision, file, note: '已经是打好补丁的状态' };
  }
  if (decision.action !== 'patch') {
    return { ok: false, error: decision.reason, decision, file };
  }
  const destination = out || file;
  const backupPath = backup || (out ? '' : file + '.vx-original.bak');
  // An explicitly requested backup is honored even when writing to `out`.
  if (backupPath) copyFileSync(file, backupPath);

  const patched = applyPatch(before, decision.target);
  writeFileSync(destination, patched);

  const readBack = readFileSync(destination);
  const verify = plan(readBack);
  const ok = readBack[decision.target.opcodeOffset] === PATCHED_OPCODE;
  return {
    ok,
    changed: true,
    decision,
    file: destination,
    backup: backupPath || null,
    beforeSha256: decision.sha256,
    afterSha256: sha256(readBack),
    verifyState: verify.state,
    error: ok ? '' : '回读校验失败：目标字节不是 EB',
  };
}

export function restoreFile(backup, file) {
  if (!existsSync(backup)) return { ok: false, error: '找不到备份：' + backup };
  if (!existsSync(file)) return { ok: false, error: '找不到目标：' + file };
  // Refuse to overwrite a live DLL with a file that is not actually unpatched.
  const backupState = plan(readFileSync(backup));
  if (backupState.action === 'already') {
    return { ok: false, error: '备份文件本身已是打过补丁的状态，拒绝用它还原（' + backup + '）' };
  }
  copyFileSync(backup, file);
  const readBack = readFileSync(file);
  const result = plan(readBack);
  return {
    ok: result.state === 'original',
    file,
    from: backup,
    state: result.state,
    sha256: sha256(readBack),
    error: result.state === 'original' ? '' : '还原后状态不是 original（' + result.state + '）',
  };
}

// ---- CLI
const isMain = (() => {
  try {
    return process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('lib/patch.mjs');
  } catch (e) {
    return false;
  }
})();

if (isMain) {
  const [cmd, file, ...rest] = process.argv.slice(2);
  const flag = (name) => {
    const i = rest.indexOf('--' + name);
    return i >= 0 ? rest[i + 1] : '';
  };
  const print = (obj) => console.log(JSON.stringify(obj, null, 2));
  try {
    if (cmd === 'scan') {
      const buf = readFileSync(file);
      const r = plan(buf);
      print({
        file,
        bytes: r.bytes,
        sha256: r.sha256,
        state: r.state,
        action: r.action,
        reason: r.reason,
        sites: r.sites.map((s) => ({ opcodeOffset: s.opcodeOffset, opcode: '0x' + s.opcode.toString(16).toUpperCase(), state: s.state })),
      });
    } else if (cmd === 'patch') {
      print(patchFile(file, { out: flag('out'), backup: flag('backup') }));
    } else if (cmd === 'restore') {
      print(restoreFile(file, rest[0]));
    } else {
      console.log('usage: node lib/patch.mjs scan|patch|restore <file> [--out f] [--backup f]');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(String((e && e.message) || e));
    process.exitCode = 1;
  }
}
