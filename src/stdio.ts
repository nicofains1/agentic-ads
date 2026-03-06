#!/usr/bin/env node

// Dedicated stdio entrypoint for MCP clients (Claude Desktop, Cursor, etc.)
// Forces stdio transport mode so registries like Glama.ai index this as an MCP server.

if (!process.argv.includes('--stdio')) {
  process.argv.push('--stdio');
}

await import('./server.js');
