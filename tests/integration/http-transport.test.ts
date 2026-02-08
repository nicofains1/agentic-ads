// ──────────────────────────────────────────────────────────────────────────────
// HTTP Transport Integration Tests (#34)
// Tests: health endpoint, auth via Bearer, 404, MCP over HTTP
// ──────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDatabase, createAdvertiser, createDeveloper } from '../../src/db/index.js';
import { generateApiKey } from '../../src/auth/middleware.js';

const SERVER_PATH = resolve('dist/server.js');

describe('HTTP Transport', () => {
  let serverProcess: ChildProcess;
  let dbPath: string;
  let advKey: string;
  let devKey: string;
  const PORT = 3199; // Use a non-standard port to avoid conflicts
  const BASE_URL = `http://localhost:${PORT}`;

  beforeAll(async () => {
    // Create temp DB and seed it
    const tmpDir = mkdtempSync(join(tmpdir(), 'agentic-ads-http-'));
    dbPath = join(tmpDir, 'test.db');

    const db = initDatabase(dbPath);
    const adv = createAdvertiser(db, { name: 'HTTPBrand' });
    advKey = generateApiKey(db, 'advertiser', adv.id);
    const dev = createDeveloper(db, { name: 'HTTPBot' });
    devKey = generateApiKey(db, 'developer', dev.id);
    db.close();

    // Start HTTP server
    serverProcess = spawn('node', [SERVER_PATH, '--http', '--port', String(PORT), '--db', dbPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10_000);
      serverProcess.stderr?.on('data', (data: Buffer) => {
        if (data.toString().includes('listening on')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      serverProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        serverProcess.on('close', () => resolve());
        setTimeout(resolve, 2000); // fallback
      });
    }
    // Clean up
    for (const suffix of ['', '-shm', '-wal']) {
      const f = dbPath + suffix;
      if (existsSync(f)) try { unlinkSync(f); } catch {}
    }
  });

  // ─── Health Endpoint ─────────────────────────────────────────────────────────

  it('GET /health → 200 with status ok', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.server).toBe('agentic-ads');
    expect(body.version).toBe('0.1.0');
  });

  // ─── 404 for unknown paths ───────────────────────────────────────────────────

  it('GET /unknown → 404', async () => {
    const res = await fetch(`${BASE_URL}/unknown`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Not found');
  });

  it('GET / → 404', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(404);
  });

  // ─── Auth via Bearer Header ──────────────────────────────────────────────────

  it('POST /mcp with invalid API key → 401', async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer aa_adv_' + 'f'.repeat(64),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        id: 1,
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('POST /mcp with valid API key → initializes session', async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${advKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        id: 1,
      }),
    });
    expect(res.status).toBe(200);
    // Should return a session ID in headers
    const sessionId = res.headers.get('mcp-session-id');
    expect(sessionId).toBeDefined();
    expect(typeof sessionId).toBe('string');
  });

  it('POST /mcp without API key → public mode (no 401)', async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'public-test', version: '1.0' },
        },
        id: 1,
      }),
    });
    // No key = public mode, should not 401
    expect(res.status).toBe(200);
  });

  // ─── Session Persistence ───────────────────────────────────────────────────

  it('session ID allows reusing connection', async () => {
    // First request: initialize
    const initRes = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${advKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'session-test', version: '1.0' },
        },
        id: 1,
      }),
    });
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get('mcp-session-id');
    expect(sessionId).toBeDefined();

    // Second request: send initialized notification using session ID
    const notifRes = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
    // Notifications may return 200 or 202 (accepted)
    expect([200, 202, 204]).toContain(notifRes.status);
  });
  // ─── Developer Key via HTTP ──────────────────────────────────────────────

  it('POST /mcp with developer API key → initializes session', async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${devKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'dev-test', version: '1.0' },
        },
        id: 1,
      }),
    });
    expect(res.status).toBe(200);
    const sessionId = res.headers.get('mcp-session-id');
    expect(sessionId).toBeDefined();
  });

  // ─── Session Cleanup (DELETE) ───────────────────────────────────────────

  it('DELETE /mcp with session ID → closes session, subsequent requests fail', async () => {
    // 1. Initialize a session
    const initRes = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${advKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'delete-test', version: '1.0' },
        },
        id: 1,
      }),
    });
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get('mcp-session-id');
    expect(sessionId).toBeDefined();

    // 2. DELETE the session
    const deleteRes = await fetch(`${BASE_URL}/mcp`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId!,
      },
    });
    expect([200, 204]).toContain(deleteRes.status);

    // 3. Try to use the session — should fail (session gone)
    const postRes = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
    // Session no longer exists — transport.handleRequest should reject
    // MCP spec: unknown session returns 404 or similar error
    expect([400, 404, 409]).toContain(postRes.status);
  });
}, { timeout: 30_000 });
