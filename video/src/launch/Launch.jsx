import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { Background, Grain } from '../components/Background.jsx';
import { Music, Sfx } from '../components/Sound.jsx';
import { CHAPTERS, CLI_FEATURES, CLI_FEATURE_BEATS, DURATION, MUSIC, bar } from './timeline.js';
import { FPS, beats } from '../theme.js';
import { COMPARE_TIMES } from '../scenes3d/features.jsx';

// a moment of the compare chapter's 3D scene, which starts 8 frames before its second bar
const compareAt = s => bar(53) - 8 + Math.round(s * FPS);
import { ClaudeScene, CliScene, CompareScene, EndScene, FrameworksScene, HarnessScene, McpScene, NpmScene, OpenScene, OpenSourceScene, ProblemScene, VsCodeScene } from './scenes.jsx';

// Spectra's launch film: the cold open, the problem, then MCP, Claude Code,
// VS Code, the npm package and its CLI, comparing two commits (with PDF
// reports), the AI fix harness, frameworks and open source.
const SCENES = { open: OpenScene, problem: ProblemScene, mcp: McpScene, claude: ClaudeScene, vscode: VsCodeScene, npm: NpmScene, cli: CliScene, compare: CompareScene, harness: HarnessScene, frameworks: FrameworksScene, 'open-source': OpenSourceScene, end: EndScene };

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
    {['mcp', 'claude', 'vscode', 'cli', 'compare', 'harness'].map(id => (
      <Sfx key={id} name="impact" at={bar(CHAPTERS.find(c => c.id === id).from)} volume={0.3} />
    ))}
    {CLI_FEATURES.map((x, i) => (
      <Sfx key={x.scene} name="tick" at={bar(37) + i * beats(CLI_FEATURE_BEATS) + 8} volume={0.22} />
    ))}
    <Sfx name="chime" at={bar(16) + beats(4) * 5.6 + 6} volume={0.4} />
    {/* compare: the summary arrives, each section lifts out, the reports change places, each file row lifts out */}
    <Sfx name="whoosh" at={compareAt(COMPARE_TIMES.summaryIn)} volume={0.28} />
    {[0, 1, 2, 3, 4].map(i => (
      <Sfx key={`part${i}`} name="tick" at={compareAt(COMPARE_TIMES.partsAt + i * COMPARE_TIMES.partGap)} volume={0.2} />
    ))}
    <Sfx name="whoosh" at={compareAt(COMPARE_TIMES.aside)} volume={0.24} />
    {[0, 1, 2].map(i => (
      <Sfx key={`row${i}`} name="tick" at={compareAt(COMPARE_TIMES.rowsAt + i * COMPARE_TIMES.rowGap)} volume={0.22} />
    ))}
    <Sfx name="chime" at={compareAt(COMPARE_TIMES.rowsAt + 2 * COMPARE_TIMES.rowGap + 0.4)} volume={0.3} />
    <Sfx name="chime" at={bar(65) + 248} volume={0.35} />
    <Sfx name="impact" at={bar(76)} volume={0.55} />
  </AbsoluteFill>
);
export { DURATION, MUSIC };
