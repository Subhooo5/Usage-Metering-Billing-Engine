const { HttpError } = require('../errors');

function parseWith(schema, data, field = 'body') {
  const result = schema.safeParse(data);

  if (!result.success) {
    const issue = result.error.issues[0];
    const name = issue.path.join('.') || field;
    throw new HttpError(400, 'invalid_request', `${name}: ${issue.message}`);
  }
  
  return result.data;
}

module.exports = { parseWith };