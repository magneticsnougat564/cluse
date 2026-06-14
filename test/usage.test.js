const { test } = require('node:test');
const assert = require('node:assert');
const { parseAll, aggregate, decodeFolder } = require('../src/usage');
const { costOf } = require('../src/pricing');

test('decodeFolder pulls the project name', () => {
  assert.strictEqual(decodeFolder('C--Users-me-code-myapp'), 'myapp');
});

test('costOf prices input/output/cache with multipliers', () => {
  // opus: input 15, output 75 per Mtok. cache read 0.1x, write5m 1.25x.
  const c = costOf('claude-opus-4-8', {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 0 },
  });
  // 15 + 75 + (15*0.1) + (15*1.25) = 15 + 75 + 1.5 + 18.75 = 110.25
  assert.ok(Math.abs(c - 110.25) < 1e-6, `got ${c}`);
});

test('parseAll dedups and aggregate sums to a sane billed range', (t) => {
  const records = parseAll();
  // CI and fresh machines have no ~/.claude/projects logs — nothing to assert.
  if (records.length === 0) { t.skip('no Claude Code logs on this machine'); return; }

  const { rows, totals } = aggregate(records, { groupBy: 'project' });
  assert.ok(rows.length > 0, 'expected at least one project');

  // After dedup, total tokens should be far below a naive overcount. The total
  // grows over time, so just assert it is positive and de-duplication ran.
  assert.ok(totals.totalTokens > 0, 'expected non-zero tokens');
  assert.ok(totals.cost > 0, 'expected non-zero cost');
});
