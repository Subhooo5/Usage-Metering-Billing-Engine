const test = require('node:test');
const assert = require('node:assert/strict');
const { checkQuota, crossedThresholds } = require('../src/services/quota');

const free = { id: 'free', api_call_limit: 1000, token_limit: 100000 };
const pro = { id: 'pro', api_call_limit: 1000, token_limit: 100000 };
const period = { start: new Date(Date.UTC(2026, 9, 1)), end: new Date(Date.UTC(2026, 10, 1)) };
const now = new Date(Date.UTC(2026, 9, 12));
const active = { status: 'active' };

function check(plan, used, requested, tenant = active) {
  return checkQuota({ tenant, plan, used, requested, period, now });
}

test('999 of 1000 calls: the next call is allowed', () => {
  assert.equal(check(free, { apiCalls: 999, tokens: 0 }, { apiCalls: 1, tokens: 0 }), null);
});

test('1000 of 1000 calls: free plan gets 402 with a message', () => {
  const blocked = check(free, { apiCalls: 1000, tokens: 0 }, { apiCalls: 1, tokens: 0 });
  assert.equal(blocked.status, 402);
  assert.equal(blocked.body.error, 'upgrade_required');
  assert.ok(blocked.body.message.length > 0);
});

test('1000 of 1000 calls: pro plan gets 429 with Retry-After', () => {
  const blocked = check(pro, { apiCalls: 1000, tokens: 0 }, { apiCalls: 1, tokens: 0 });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['Retry-After'], '1728000');
});

test('a token request larger than the remainder is rejected whole', () => {
  const blocked = check(free, { apiCalls: 0, tokens: 99000 }, { apiCalls: 1, tokens: 2000 });
  assert.equal(blocked.status, 402);
  assert.equal(blocked.body.metric, 'ai_tokens');
});

test('past due tenants get 402 payment_required', () => {
  const blocked = check(pro, { apiCalls: 0, tokens: 0 }, { apiCalls: 1, tokens: 0 }, { status: 'past_due' });
  assert.equal(blocked.status, 402);
  assert.equal(blocked.body.error, 'payment_required');
});

test('crossing 80 percent is detected once', () => {
  const crossed = crossedThresholds({ apiCalls: 799, tokens: 0 }, { apiCalls: 800, tokens: 0 }, free, [80, 100]);
  assert.deepEqual(crossed, [{ metric: 'api_calls', threshold: 80 }]);
  assert.deepEqual(crossedThresholds({ apiCalls: 800, tokens: 0 }, { apiCalls: 801, tokens: 0 }, free, [80, 100]), []);
});