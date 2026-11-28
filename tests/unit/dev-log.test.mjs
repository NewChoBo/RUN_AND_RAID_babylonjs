import assert from 'node:assert/strict';
import test from 'node:test';
import { devLog } from '../../src/content/dev-log.ts';

test('development log entries include a 24-hour KST timestamp and appear newest first', () => {
  let previous = Infinity;
  for (const { title, updatedAt } of devLog) {
    assert.match(updatedAt, /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d\+09:00$/, title);
    const instant = Date.parse(updatedAt);
    assert.ok(instant <= previous, title);
    previous = instant;
  }
});
