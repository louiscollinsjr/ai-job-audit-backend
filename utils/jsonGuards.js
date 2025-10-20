function isBalancedJSON(input = '') {
  if (!input || typeof input !== 'string') {
    return false;
  }
  const stack = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push(char);
    } else if (char === '}' || char === ']') {
      if (!stack.length) {
        return false;
      }
      const last = stack.pop();
      if ((char === '}' && last !== '{') || (char === ']' && last !== '[')) {
        return false;
      }
    }
  }
  if (escape) {
    return false;
  }
  return !inString && stack.length === 0;
}

function ensureJsonSafeOutput(raw) {
  if (raw && typeof raw === 'object') {
    return raw;
  }
  const candidate = typeof raw === 'string' ? raw.trim() : '';
  if (!candidate) {
    throw new Error('Empty LLM output');
  }
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const firstBracket = candidate.indexOf('[');
  const lastBracket = candidate.lastIndexOf(']');

  let start = -1;
  let end = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace <= firstBracket)) {
    start = firstBrace;
    end = lastBrace;
  } else if (firstBracket !== -1) {
    start = firstBracket;
    end = lastBracket;
  }

  let sliced = candidate;
  if (start !== -1 && end !== -1 && end > start) {
    sliced = candidate.slice(start, end + 1);
  }
  if (!isBalancedJSON(sliced)) {
    throw new Error('Unbalanced JSON payload');
  }
  try {
    return JSON.parse(sliced);
  } catch (error) {
    const preview = sliced.length > 400 ? `${sliced.slice(0, 400)}…` : sliced;
    const message = `Failed to parse JSON payload: ${error?.message || 'Unknown error'} :: ${preview}`;
    if (error && typeof error === 'object') {
      throw new Error(message, { cause: error });
    }
    throw new Error(message);
  }
}

module.exports = {
  isBalancedJSON,
  ensureJsonSafeOutput
};
