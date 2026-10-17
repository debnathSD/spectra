import React from 'react';
import { Composition } from 'remotion';
import { CLAUDE_PROPS, ClaudeCode, DURATION as CLAUDE_CODE } from './claude/ClaudeCode.jsx';
import { DURATION as MCP_SERVER, MCP_PROPS, McpServer } from './mcp/McpServer.jsx';
import { FEATURE_IDS, FeatureLoop } from './features/FeatureLoop.jsx';
import { DURATION as HARNESS, FixHarnessVideo, HARNESS_PROPS } from './harness/FixHarness.jsx';
import { DURATION as LAUNCH, Launch, MUSIC as LAUNCH_PROPS } from './launch/Launch.jsx';
import { FPS, HEIGHT, WIDTH } from './theme.js';
import { DURATION as VSCODE, VSCODE_PROPS, VSCode } from './vscode/VSCode.jsx';

// One composition per docs page; the id is the file name on the website.
// most feature loops run six seconds; the commit comparison takes its two PDFs apart, so it runs 21
const LOOPS = { compare: { frames: 630, poster: 300 } };

export const Root = () => (
  <>
    <Composition id="vscode" component={VSCode} durationInFrames={VSCODE} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={VSCODE_PROPS} />
    <Composition id="claude-code" component={ClaudeCode} durationInFrames={CLAUDE_CODE} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={CLAUDE_PROPS} />
    <Composition id="fix-harness" component={FixHarnessVideo} durationInFrames={HARNESS} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={HARNESS_PROPS} />
    <Composition id="launch" component={Launch} durationInFrames={LAUNCH} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={LAUNCH_PROPS} />
    {FEATURE_IDS.map(feature => (
      <Composition key={feature} id={`feature-${feature}`} component={FeatureLoop} durationInFrames={LOOPS[feature]?.frames ?? 180} fps={30} width={960} height={540} defaultProps={{ feature, poster: LOOPS[feature]?.poster ?? 84 }} />
    ))}
    <Composition id="mcp-server" component={McpServer} durationInFrames={MCP_SERVER} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={MCP_PROPS} />
  </>
);
