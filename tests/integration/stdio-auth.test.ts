// ──────────────────────────────────────────────────────────────────────────────
// Stdio Auth Edge Cases (#34)
// Tests: invalid key exit, no key public mode, env var auth, stderr logging
// ──────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDatabase, createAdvertiser, createDeveloper } from '../../src/db/index.js';
import { generateApiKey } from '../../src/auth/middleware.js';

const SERVER_PATH = resolve('dist/server.js');

describe('Stdio auth edge cases', () => {
  let dbPath: string;
  let advKey: string;

  beforeAll(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agentic-ads-stdio-auth-'));
    dbPath = join(tmpDir, 'test.db');
    const db = initDatabase(dbPath);
    const adv = createAdvertiser(db, { name: 'AuthTest' });
    advKey = generateApiKey(db, 'advertiser', adv.id);
    db.close();
  });

  afterAll(() => {
    for (const suffix of ['', '-shm', '-wal']) {
      const f = dbPath + suffix;
      if (existsSync(f)) try { unlinkSync(f); } catch {}
    }
  });

  it('invalid API key → exits with code 1 and logs "Auth failed"', async () => {
    const proc = spawn('node', [
      SERVER_PATH, '--stdio', '--db', dbPath,
      '--api-key', 'aa_adv_' + 'f'.repeat(64),
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stderr = await new Promise<string>((resolve) => {
      let data = '';
      proc.stderr?.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      proc.on('close', () => resolve(data));
    });

    expect(stderr).toContain('Auth failed');
  });

  it('invalid API key → exit code 1', async () => {
    const exitCode = await new Promise<number | null>((resolve) => {
      const proc = spawn('node', [
        SERVER_PATH, '--stdio', '--db', dbPath,
        '--api-key', 'aa_adv_' + 'f'.repeat(64),
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      proc.on('close', (code) => resolve(code));
    });

    expect(exitCode).toBe(1);
  });

  it('no API key → logs "running without authentication"', async () => {
    const proc = spawn('node', [
      SERVER_PATH, '--stdio', '--db', dbPath,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stderr = await new Promise<string>((resolve, reject) => {
      let data = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve(data);
      }, 3000);
      proc.stderr?.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes('running without authentication')) {
          clearTimeout(timeout);
          proc.kill('SIGTERM');
          resolve(data);
        }
      });
      proc.on('error', reject);
    });

    expect(stderr).toContain('running without authentication');
  });

  it('valid API key → logs "Authenticated as" and entity type', async () => {
    const proc = spawn('node', [
      SERVER_PATH, '--stdio', '--db', dbPath,
      '--api-key', advKey,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stderr = await new Promise<string>((resolve, reject) => {
      let data = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve(data);
      }, 3000);
      proc.stderr?.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes('Authenticated as')) {
          clearTimeout(timeout);
          proc.kill('SIGTERM');
          resolve(data);
        }
      });
      proc.on('error', reject);
    });

    expect(stderr).toContain('Authenticated as advertiser');
  });

  it('all logs go to stderr (not stdout)', async () => {
    const proc = spawn('node', [
      SERVER_PATH, '--stdio', '--db', dbPath,
      '--api-key', advKey,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const result = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({ stdout, stderr });
      }, 2000);
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.includes('MCP server running on stdio')) {
          clearTimeout(timeout);
          proc.kill('SIGTERM');
          resolve({ stdout, stderr });
        }
      });
    });

    // Logs should be on stderr, not stdout (stdout is reserved for MCP protocol)
    expect(result.stderr).toContain('agentic-ads');
    expect(result.stdout).toBe('');
  });

  it('env var AGENTIC_ADS_API_KEY is used when --api-key not provided', async () => {
    const proc = spawn('node', [
      SERVER_PATH, '--stdio', '--db', dbPath,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, AGENTIC_ADS_API_KEY: advKey },
    });

    const stderr = await new Promise<string>((resolve, reject) => {
      let data = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve(data);
      }, 3000);
      proc.stderr?.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes('Authenticated as')) {
          clearTimeout(timeout);
          proc.kill('SIGTERM');
          resolve(data);
        }
      });
      proc.on('error', reject);
    });

    expect(stderr).toContain('Authenticated as advertiser');
  });
}, { timeout: 30_000 });
