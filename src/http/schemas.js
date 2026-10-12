const { z } = require('zod');

const tokenCount = z.number().int().min(0).max(10000000);

const generateSchema = z
  .object({
    prompt: z.string().min(1).max(4000).optional(),
    tokens: z
      .object({
        input: tokenCount.optional(),
        cachedInput: tokenCount.optional(),
        output: tokenCount.optional(),
        reasoning: tokenCount.optional()
      })
      .strict()
      .optional()
  })
  .strict();

const idempotencyKeySchema = z.string().min(1).max(255);

function normalizeTokens(tokens = {}) {
  return {
    input: tokens.input ?? 0,
    cachedInput: tokens.cachedInput ?? 0,
    output: tokens.output ?? 0,
    reasoning: tokens.reasoning ?? 0
  };
}

module.exports = { generateSchema, idempotencyKeySchema, normalizeTokens };