#!/usr/bin/env node

// Agentic Ads MCP Server — Entry point
// See docs/PRD.md for architecture details

const args = process.argv.slice(2);

const mode = args.includes("--stdio")
  ? "stdio"
  : args.includes("--http")
    ? "http"
    : "stdio";

const portFlag = args.indexOf("--port");
const port =
  portFlag !== -1 ? parseInt(args[portFlag + 1], 10) : 3000;

console.error(`[agentic-ads] Starting in ${mode} mode${mode === "http" ? ` on port ${port}` : ""}...`);

// TODO(#3): Initialize MCP server with tools and transports
