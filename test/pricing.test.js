const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCostNano, totalTokens, formatUsd } = require('../src/services/pricing');

const tokens = { input: 10000, cachedInput: 40000, output: 2000, reasoning: 3000 };

test('mixed token categories give the exact pinned total', () => {
  assert.equal(calculateCostNano(1, tokens), 21000000);
  assert.equal(formatUsd(21000000), '0.021000');
});

test('total tokens counts every category once', () => {
  assert.equal(totalTokens(tokens), 55000);
});

test('cached input is cheaper than fresh input', () => {
  const fresh = calculateCostNano(0, { input: 1000, cachedInput: 0, output: 0, reasoning: 0 });
  const cached = calculateCostNano(0, { input: 0, cachedInput: 1000, output: 0, reasoning: 0 });
  assert.ok(cached < fresh);
});

test('reasoning tokens are billed as output tokens', () => {
  const output = calculateCostNano(0, { input: 0, cachedInput: 0, output: 1000, reasoning: 0 });
  const reasoning = calculateCostNano(0, { input: 0, cachedInput: 0, output: 0, reasoning: 1000 });
  assert.equal(reasoning, output);
});

test('a request with no tokens costs one API call', () => {
  assert.equal(calculateCostNano(1, { input: 0, cachedInput: 0, output: 0, reasoning: 0 }), 1000000);
});