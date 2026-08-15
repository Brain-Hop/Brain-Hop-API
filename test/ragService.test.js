const test = require('node:test');
const assert = require('node:assert/strict');
const { splitText } = require('../src/services/ragService');

test('splitText returns clean input as one chunk', () => {
  assert.deepEqual(splitText('  concise message  '), ['concise message']);
});

test('splitText creates overlapping chunks for long text', () => {
  const input = Array.from({ length: 600 }, () => 'word').join(' ');
  const chunks = splitText(input, 100, 20);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 100));
});

test('splitText does not emit empty chunks', () => {
  assert.deepEqual(splitText('   '), []);
});
