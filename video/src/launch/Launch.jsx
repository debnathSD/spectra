import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { Background, Grain } from '../components/Background.jsx';
import { Music, Sfx } from '../components/Sound.jsx';
import { CHAPTERS, CLI_FEATURES, CLI_FEATURE_BEATS, DURATION, MUSIC, bar } from './timeline.js';
import { beats } from '../theme.js';
import { ClaudeScene, CliScene, EndScene, FrameworksScene, McpScene, NpmScene, OpenScene, OpenSourceScene, ProblemScene, VsCodeScene } from './scenes.jsx';

// Spectra's two-minute launch film: the cold open, the problem, then MCP,
// Claude Code, VS Code, the npm package and its CLI, frameworks, open source.
const SCENES = { open: OpenScene, problem: ProblemScene, mcp: McpScene, claude: ClaudeScene, vscode: VsCodeScene, npm: NpmScene, cli: CliScene, frameworks: FrameworksScene, 'open-source': OpenSourceScene, end: EndScene };

export const Launch = () => (
  <AbsoluteFill>
    <Background />
    {CHAPTERS.map(c => {
      const Scene = SCENES[c.id];
      const from = bar(c.from);
      const len = bar(c.to) - from;
      return (
        <Sequence key={c.id} from={from} durationInFrames={len} layout="none">
          <AbsoluteFill>
            <Scene len={len} />
          </AbsoluteFill>
        </Sequence>
      );
    })}
    <Grain />

    <Music name="launch" duration={DURATION} />
    {CHAPTERS.slice(1).map(c => (
      <Sfx key={c.id} name="whoosh" at={bar(c.from) - 12} volume={0.4} />
    ))}
    <Sfx name="impact" at={bar(0)} volume={0.5} />
    <Sfx name="impact" at={bar(6)} volume={0.35} />
    {['mcp', 'claude', 'vscode', 'cli'].map(id => (
      <Sfx key={id} name="impact" at={bar(CHAPTERS.find(c => c.id === id).from)} volume={0.3} />
    ))}
    {CLI_FEATURES.map((x, i) => (
      <Sfx key={x.scene} name="tick" at={bar(37) + i * beats(CLI_FEATURE_BEATS) + 8} volume={0.22} />
    ))}
    <Sfx name="chime" at={bar(16) + beats(4) * 5.6 + 6} volume={0.4} />
    <Sfx name="impact" at={bar(60)} volume={0.55} />
  </AbsoluteFill>
);
export { DURATION, MUSIC };
