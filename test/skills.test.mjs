import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, labelOf, digestOf, diffSkills } from '../lib/skills.mjs';

const skill = (name, fingerprint, source = 'fs') => ({ name, fingerprint, source });

test('identity keeps a disk skill and an OpenViking skill with the same name apart', () => {
  assert.equal(keyOf(skill('rea', 'A')), 'fs:rea');
  assert.equal(keyOf(skill('rea', 'B', 'openviking')), 'openviking:rea');
  assert.equal(labelOf(skill('rea', 'B', 'openviking')), 'rea (ov)');
  assert.equal(labelOf(skill('rea', 'A')), 'rea');
});

test('the first scan only establishes a baseline', () => {
  const diff = diffSkills(null, [skill('a', '1'), skill('b', '2')]);
  assert.equal(diff.initial, true);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.changed.length, 0);
  assert.equal(diff.removed.length, 0);
});

test('an unchanged rescan reports nothing', () => {
  const before = [skill('a', '1'), skill('b', '2')];
  const diff = diffSkills(before, [skill('a', '1'), skill('b', '2')]);
  assert.deepEqual([diff.added.length, diff.changed.length, diff.removed.length], [0, 0, 0]);
});

test('added, changed and removed are each detected', () => {
  const before = [skill('a', '1'), skill('b', '2')];
  const after = [skill('a', '1-NEW'), skill('c', '3')];
  const diff = diffSkills(before, after);
  assert.equal(diff.initial, false);
  assert.deepEqual(diff.added.map((s) => s.name), ['c']);
  assert.deepEqual(diff.changed.map((s) => s.name), ['a']);
  assert.deepEqual(diff.removed.map((s) => s.name), ['b']);
});

test('a same-name skill arriving from OpenViking is new, not a change', () => {
  const before = [skill('rea', '1')];
  const after = [skill('rea', '1'), skill('rea', '2', 'openviking')];
  const diff = diffSkills(before, after);
  assert.deepEqual(diff.added.map((s) => s.name), ['rea']);
  assert.equal(diff.added[0].source, 'openviking');
  assert.equal(diff.changed.length, 0);
});

test('digest is order independent but content sensitive', () => {
  const a = digestOf([skill('a', '1'), skill('b', '2')]);
  const b = digestOf([skill('b', '2'), skill('a', '1')]);
  const c = digestOf([skill('a', '1'), skill('b', '3')]);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
