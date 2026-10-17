import React from 'react';
import { Composition } from 'remotion';
import { CLAUDE_PROPS, ClaudeCode, DURATION as CLAUDE_CODE } from './claude/ClaudeCode.jsx';
import { DURATION as MCP_SERVER, MCP_PROPS, McpServer } from './mcp/McpServer.jsx';
import { FPS, HEIGHT, WIDTH } from './theme.js';
import { DURATION as VSCODE, VSCODE_PROPS, VSCode } from './vscode/VSCode.jsx';

// One composition per docs page; the id is the file name on the website.
export const Root = () => (
  <>
    <Composition id="vscode" component={VSCode} durationInFrames={VSCODE} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={VSCODE_PROPS} />
    <Composition id="claude-code" component={ClaudeCode} durationInFrames={CLAUDE_CODE} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={CLAUDE_PROPS} />
    <Composition id="mcp-server" component={McpServer} durationInFrames={MCP_SERVER} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={MCP_PROPS} />
  </>
);
