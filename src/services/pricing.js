const config = require('../config');

function totalTokens(tokens) {
  return tokens.input + tokens.cachedInput + tokens.output + tokens.reasoning;
}

function calculateCostNano(apiCalls, tokens) {
  const price = config.pricing;
  return (
    apiCalls * price.apiCallNano +
    tokens.input * price.inputTokenNano +
    tokens.cachedInput * price.cachedInputTokenNano +
    (tokens.output + tokens.reasoning) * price.outputTokenNano
  );
}

function formatUsd(nano) {
  const micro = Math.round(nano / 1000);
  const whole = Math.floor(micro / 1000000);
  const fraction = String(micro % 1000000).padStart(6, '0');
  return `${whole}.${fraction}`;
}

module.exports = { totalTokens, calculateCostNano, formatUsd };