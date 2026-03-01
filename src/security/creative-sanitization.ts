// ──────────────────────────────────────────────────────────────────────────────
// Creative Text Sanitization (#93)
// Defense-in-depth against prompt injection in advertiser-provided creative_text
// ──────────────────────────────────────────────────────────────────────────────

export const CREATIVE_TEXT_MAX_LENGTH = 500;

export const PROMPT_INJECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /ignore\s+(all|previous|above|prior)\s+(instructions|prompts|rules)/i, reason: 'contains instruction override attempt' },
  { pattern: /system:|<\/?system>/i, reason: 'contains system-level markup' },
  { pattern: /you\s+are\s+now|you\s+must\s+now|act\s+as/i, reason: 'contains identity manipulation attempt' },
  { pattern: /```(?:bash|python|shell)/i, reason: 'contains executable code block' },
  { pattern: /tool_call|function_call|<tool_use>/i, reason: 'contains tool invocation attempt' },
  { pattern: /IMPORTANT:|CRITICAL:/i, reason: 'contains instruction-style override' },
];

export function validateCreativeText(text: string): { valid: boolean; reason?: string } {
  if (text.length > CREATIVE_TEXT_MAX_LENGTH) {
    return { valid: false, reason: `creative_text exceeds maximum length of ${CREATIVE_TEXT_MAX_LENGTH} characters` };
  }

  for (const { pattern, reason } of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { valid: false, reason };
    }
  }

  return { valid: true };
}
