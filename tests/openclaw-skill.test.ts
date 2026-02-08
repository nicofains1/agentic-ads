// ──────────────────────────────────────────────────────────────────────────────
// OpenClaw Skill Validation (#34)
// Tests: SKILL.md YAML frontmatter, mcp-config.example.json structure
// ──────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SKILL_PATH = resolve('openclaw-skill/SKILL.md');
const MCP_CONFIG_PATH = resolve('openclaw-skill/mcp-config.example.json');

describe('OpenClaw Skill', () => {
  describe('SKILL.md', () => {
    const content = readFileSync(SKILL_PATH, 'utf-8');

    it('has YAML frontmatter delimited by ---', () => {
      expect(content.startsWith('---\n')).toBe(true);
      const secondDash = content.indexOf('---', 4);
      expect(secondDash).toBeGreaterThan(4);
    });

    it('frontmatter contains name: agentic-ads', () => {
      const frontmatter = content.split('---')[1];
      expect(frontmatter).toContain('name: agentic-ads');
    });

    it('frontmatter contains version', () => {
      const frontmatter = content.split('---')[1];
      expect(frontmatter).toMatch(/version:\s*\d+\.\d+\.\d+/);
    });

    it('frontmatter requires AGENTIC_ADS_API_KEY env var', () => {
      const frontmatter = content.split('---')[1];
      expect(frontmatter).toContain('AGENTIC_ADS_API_KEY');
    });

    it('frontmatter requires AGENTIC_ADS_URL env var', () => {
      const frontmatter = content.split('---')[1];
      expect(frontmatter).toContain('AGENTIC_ADS_URL');
    });

    it('documents search_ads tool usage', () => {
      expect(content).toContain('search_ads');
    });

    it('documents report_event tool usage', () => {
      expect(content).toContain('report_event');
    });

    it('documents get_ad_guidelines tool', () => {
      expect(content).toContain('get_ad_guidelines');
    });

    it('includes impression, click, conversion event types', () => {
      expect(content).toContain('impression');
      expect(content).toContain('click');
      expect(content).toContain('conversion');
    });

    it('includes opt-out guidance (no ads / stop showing ads)', () => {
      expect(content).toContain('no ads');
      expect(content).toContain('stop showing ads');
    });

    it('includes disclosure requirement (Sponsored)', () => {
      expect(content).toContain('Sponsored');
    });
  });

  describe('mcp-config.example.json', () => {
    const raw = readFileSync(MCP_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);

    it('has mcpServers.agentic-ads key', () => {
      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers['agentic-ads']).toBeDefined();
    });

    it('uses node command', () => {
      expect(config.mcpServers['agentic-ads'].command).toBe('node');
    });

    it('args include dist/server.js and --stdio', () => {
      const args = config.mcpServers['agentic-ads'].args as string[];
      expect(args.some((a: string) => a.includes('server.js'))).toBe(true);
      expect(args).toContain('--stdio');
    });

    it('args include --api-key placeholder', () => {
      const args = config.mcpServers['agentic-ads'].args as string[];
      expect(args).toContain('--api-key');
      const keyArg = args[args.indexOf('--api-key') + 1];
      expect(keyArg).toContain('aa_dev_');
    });
  });
});
