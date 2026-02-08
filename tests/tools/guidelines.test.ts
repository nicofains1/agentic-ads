import { describe, it, expect } from 'vitest';
import { getAdGuidelines, AD_GUIDELINES } from '../../src/tools/consumer/get-guidelines.js';

describe('get_ad_guidelines', () => {
  it('returns the guidelines object', () => {
    const guidelines = getAdGuidelines();
    expect(guidelines).toBeDefined();
    expect(guidelines).toBe(AD_GUIDELINES);
  });

  it('has rules array with 7 rules', () => {
    const guidelines = getAdGuidelines();
    expect(Array.isArray(guidelines.rules)).toBe(true);
    expect(guidelines.rules).toHaveLength(7);
  });

  it('each rule has id, priority, description', () => {
    const guidelines = getAdGuidelines();
    for (const rule of guidelines.rules) {
      expect(rule).toHaveProperty('id');
      expect(rule).toHaveProperty('priority');
      expect(rule).toHaveProperty('description');
      expect(typeof rule.id).toBe('string');
      expect(typeof rule.description).toBe('string');
    }
  });

  it('has required rules: disclosure, relevance, frequency, opt_out', () => {
    const guidelines = getAdGuidelines();
    const requiredIds = guidelines.rules
      .filter((r) => r.priority === 'required')
      .map((r) => r.id);
    expect(requiredIds).toContain('disclosure');
    expect(requiredIds).toContain('relevance');
    expect(requiredIds).toContain('frequency');
    expect(requiredIds).toContain('opt_out');
  });

  it('has recommended rules: natural_integration, user_value, transparency', () => {
    const guidelines = getAdGuidelines();
    const recommendedIds = guidelines.rules
      .filter((r) => r.priority === 'recommended')
      .map((r) => r.id);
    expect(recommendedIds).toContain('natural_integration');
    expect(recommendedIds).toContain('user_value');
    expect(recommendedIds).toContain('transparency');
  });

  it('has example_format string', () => {
    const guidelines = getAdGuidelines();
    expect(typeof guidelines.example_format).toBe('string');
    expect(guidelines.example_format.length).toBeGreaterThan(0);
    expect(guidelines.example_format).toContain('sponsored');
  });

  it('has reporting_instructions with impression, click, conversion', () => {
    const guidelines = getAdGuidelines();
    expect(guidelines.reporting_instructions).toHaveProperty('impression');
    expect(guidelines.reporting_instructions).toHaveProperty('click');
    expect(guidelines.reporting_instructions).toHaveProperty('conversion');
  });

  it('no auth required (pure function)', () => {
    // getAdGuidelines takes no arguments — it's a public static function
    expect(() => getAdGuidelines()).not.toThrow();
  });
});
