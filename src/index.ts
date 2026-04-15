#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MemoryStore } from './storage.js';
import { registerTools } from './tools.js';
import { registerPrompts } from './prompts.js';
import { INSTRUCTIONS } from './instructions.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const store = new MemoryStore({
  persist: process.env.HIPPOCAMPUS_PERSIST !== 'false',
  storage_path:
    process.env.HIPPOCAMPUS_STORAGE_PATH ||
    resolve(homedir(), '.hippocampus', 'memory.json'),
  max_sessions: Number(process.env.HIPPOCAMPUS_MAX_SESSIONS) || 20,
  gc: {
    minor_compress_after: Number(process.env.HIPPOCAMPUS_MINOR_COMPRESS) || 5,
    minor_delete_after: Number(process.env.HIPPOCAMPUS_MINOR_DELETE) || 15,
    major_compress_after: Number(process.env.HIPPOCAMPUS_MAJOR_COMPRESS) || 10,
    max_entries: Number(process.env.HIPPOCAMPUS_MAX_ENTRIES) || 30,
  },
});

const server = new McpServer(
  { name: 'hippocampus-mcp', version: '0.1.1' },
  { instructions: INSTRUCTIONS },
);

registerTools(server, store);
registerPrompts(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[hippocampus-mcp] MCP server started (stdio)');
}

main().catch((err) => {
  console.error('[hippocampus-mcp] Fatal:', err);
  process.exit(1);
});
