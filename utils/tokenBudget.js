const AVERAGE_CHARS_PER_TOKEN = 4;
// Empirical estimate of prompt scaffolding tokens added per section (JSON wrappers, headings, etc.)
const STRUCTURAL_TOKENS_PER_SECTION = 12;

function estimatePromptTokens({ textLength = 0, htmlLength = 0, extraTokens = 0, sectionCount = 1 }) {
  const base = Math.ceil(Math.max(textLength, htmlLength) / AVERAGE_CHARS_PER_TOKEN);
  const structuralOverhead = Math.ceil(sectionCount * STRUCTURAL_TOKENS_PER_SECTION);
  return base + structuralOverhead + extraTokens;
}

function computeMaxOutputTokens(promptTokens, targetTotal = 8000, minOutput = 1500, fallbackTotal = 6000) {
  const targetBudget = targetTotal - promptTokens;
  if (targetBudget >= minOutput) {
    return Math.max(minOutput, Math.max(0, targetBudget));
  }

  const fallbackBudget = fallbackTotal - promptTokens;
  if (fallbackBudget >= minOutput) {
    return Math.max(minOutput, Math.max(0, fallbackBudget));
  }

  return Math.max(0, targetBudget, fallbackBudget);
}

function shouldSegment({ textLength = 0, maxCharsPerSection = 4500 }) {
  return textLength > maxCharsPerSection;
}

module.exports = {
  estimatePromptTokens,
  computeMaxOutputTokens,
  shouldSegment
};
