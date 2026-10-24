import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern, findAll, scan, plan, applyPatch, restoreBytes, SIGNATURES } from '../lib/patch.mjs';

// A synthetic stand-in for the decision site:
//   call rel32 ; test al,al ; <jump> short ; mov edx,-1 ; lea rcx,[rip+rel32]
const PREFIX = Buffer.from([0x90, 0x90, 0x90]); // padding so the site is not at 0
const SITE_ORIGINAL = Buffer.from([
  0xe8, 0x11, 0x22, 0x33, 0x44, // call rel32
  0x84, 0xc0, // test al,al
  0x75, 0x19, // jne +0x19   <-- the decision
  0xba, 0xff, 0xff, 0xff, 0xff, // mov edx,-1
  0x48, 0x8d, 0x0d, 0x7b, 0x8b, 0x02, 0x00, // lea rcx,[rip+...]
]);
const SITE_PATCHED = Buffer.from(SITE_ORIGINAL);
SITE_PATCHED[7] = 0xeb;

const withSite = (site, extra = Buffer.alloc(0)) => Buffer.concat([PREFIX, site, Buffer.from([0xcc, 0xcc]), extra]);

test('parsePattern accepts wildcards and rejects junk', () => {
  const p = parsePattern('E8 ?? 84 C0');
  assert.equal(p.length, 4);
  assert.equal(p[0].value, 0xe8);
  assert.equal(p[1].wild, true);
  assert.throws(() => parsePattern('E8 ZZ'));
});

test('findAll reports every occurrence', () => {
  const needle = parsePattern('84 C0 ?? ?? BA');
  const buf = Buffer.concat([SITE_ORIGINAL, Buffer.from([0x00]), SITE_ORIGINAL]);
  assert.equal(findAll(buf, needle).length, 2);
});

test('scan classifies an untouched site as original and a patched one as patched', () => {
  const orig = scan(withSite(SITE_ORIGINAL));
  assert.equal(orig.state, 'original');
  assert.equal(orig.sites.length, 1);
  assert.equal(orig.sites[0].opcodeOffset, PREFIX.length + 7);

  const patched = scan(withSite(SITE_PATCHED));
  assert.equal(patched.state, 'patched');
});

test('a patched file is still recognised — it is not reported as unsupported', () => {
  // Regression: a signature that hard-codes 0x75 stops matching after patching,
  // which made a healthy install look like an unsupported build.
  const decision = plan(withSite(SITE_PATCHED));
  assert.equal(decision.action, 'already');
  assert.notEqual(decision.action, 'unsupported');
});

test('plan finds the site without being told any offset', () => {
  const decision = plan(withSite(SITE_ORIGINAL));
  assert.equal(decision.action, 'patch');
  assert.equal(decision.target.opcodeOffset, PREFIX.length + 7);
});

test('applyPatch rewrites exactly one byte; restoreBytes puts it back', () => {
  const buf = withSite(SITE_ORIGINAL);
  const decision = plan(buf);
  const patched = applyPatch(buf, decision.target);
  let changed = 0;
  for (let i = 0; i < buf.length; i += 1) if (buf[i] !== patched[i]) changed += 1;
  assert.equal(changed, 1);
  assert.equal(patched[decision.target.opcodeOffset], 0xeb);
  assert.equal(plan(patched).action, 'already');
  assert.equal(restoreBytes(patched, decision.target)[decision.target.opcodeOffset], 0x75);
});

test('a buffer with no site is unsupported, not silently patched', () => {
  const decision = plan(Buffer.alloc(64, 0x90));
  assert.equal(decision.action, 'unsupported');
  assert.match(decision.reason, /未命中/);
});

test('two candidate sites are ambiguous instead of guessed', () => {
  const two = Buffer.concat([withSite(SITE_ORIGINAL), withSite(SITE_ORIGINAL)]);
  const decision = plan(two);
  assert.equal(decision.action, 'ambiguous');
  assert.equal(decision.candidates.length, 2);
});

test('every declared signature uses a wildcard for the jump opcode', () => {
  for (const sig of SIGNATURES) {
    const tokens = sig.hex.trim().split(/\s+/);
    assert.equal(tokens[sig.token], '??', sig.id + ' must wildcard the opcode token');
  }
});
