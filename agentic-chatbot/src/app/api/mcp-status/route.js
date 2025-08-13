import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { experimental_createMCPClient } from 'ai'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const configPath = path.join(process.cwd(), 'mcp-config.json')
    const raw = await fs.readFile(configPath, 'utf8')
    const config = JSON.parse(raw)

    const entry = config?.mongodb
    if (!entry?.command) {
      return NextResponse.json(
        { connected: false, error: 'Invalid mcp-config.json: missing mongodb.command' },
        { status: 200 }
      )
    }

    const transport = new StdioClientTransport({
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args : [],
      env: { ...process.env, ...(entry.env || {}) },
    })

    const client = await experimental_createMCPClient({ transport })

    let tools = {}
    try {
      tools = await client.tools()
    } finally {
      await client.close()
    }

    return NextResponse.json({ connected: true, tools: Object.keys(tools || {}) })
  } catch (error) {
    console.error('MCP status check failed:', error)
    return NextResponse.json(
      { connected: false, error: error?.message || 'Unknown error' },
      { status: 200 }
    )
  }
} 