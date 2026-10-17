import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { Background, Grain } from '../components/Background.jsx';
import { Caption } from '../components/Caption.jsx';
import { EndCard, Panel, StatRows, TitleCard, Verdict } from '../components/Cards.jsx';
import { Reveal } from '../components/motion.jsx';
import { Music, Sfx } from '../components/Sound.jsx';
import { LINE, Lines, Terminal, Typed } from '../components/Terminal.jsx';
import { SceneTime } from '../scenes3d/kit.jsx';
import { FixHarness as Conveyor } from '../scenes3d/features.jsx';
import { C, beats, fonts } from '../theme.js';

// The docs video for the AI fix harness: a real test-bench session on the demo
// app (the scripted "memoize" change), the harness's decisions on the
// conveyor, the measured result, and the bench's scorecard.
const F = Object.fromEntries(Object.entries({ session: 6, result: 26, bench: 34, end: 42 }).map(([k, v]) => [k, beats(v)]));
export const DURATION = beats(52);
export const HARNESS_PROPS = { musicEnd: F.end, poster: 132 };

const dim = t => <span style={{ color: C.faint }}>{t}</span>;
const ok = t => <span style={{ color: C.green }}>{t}</span>;
// real output of `spectra fix` in the test bench (shortened)
const session = o => [
  { at: o, lines: 1, el: <div style={{ height: LINE }}><span style={{ color: C.cyan }}>$ </span><Typed text="npx spectra fix" at={o + 4} cps={24} /></div> },
  { at: o + 50, lines: 1, el: <Lines at={o + 50}>{[dim('spectra: working in a copy of cedc8cd on branch spectra/fix-…')]}</Lines> },
  { at: o + 80, lines: 1, el: <Lines at={o + 80}>{[dim('spectra: running the checks before any change (npm test) …')]}</Lines> },
  { at: o + 110, lines: 1, el: <Lines at={o + 110}>{[dim('spectra: measuring the baseline …')]}</Lines> },
  { at: o + 150, lines: 1, el: <Lines at={o + 150}>{[<>spectra: [1/1] <span style={{ color: '#ff9fb2' }}>Row is slow to render: 1442ms</span> — src/Row.jsx:3</>]}</Lines> },
  { at: o + 200, lines: 1, el: <Lines at={o + 200}>{[<>spectra: [1/1] changed <span style={{ color: C.cyan }}>src/Row.jsx</span> (+2 −1)</>]}</Lines> },
  { at: o + 240, lines: 1, el: <Lines at={o + 240}>{[dim('spectra: [1/1] running the checks …')]}</Lines> },
  { at: o + 280, lines: 1, el: <Lines at={o + 280}>{[dim('spectra: [1/1] measuring the change …')]}</Lines> },
  { at: o + 330, lines: 1, el: <Lines at={o + 330}>{[<>spectra: [1/1] {ok('✓ kept (7cae6fa)')}: CPU 1.57 s → 152 ms (−90%)</>]}</Lines> },
];

const BENCH = [
  ['memoize', 'kept', 'a real fix'],
  ['breaks-page', 'checks failed', 'faster, but broken'],
  ['no-gain', 'no measurable gain', 'a cosmetic change'],
  ['touches-config', 'out of scope', 'edits package.json'],
];

export const FixHarnessVideo = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Background />
      <Sequence durationInFrames={F.session + 10}>
        <TitleCard kicker="The Spectra AI fix harness" words={['Fixes', 'that', 'prove', 'themselves.']} accent={[2, 3]} sub="An agent fixes the costliest findings; Spectra keeps only what measurably helps." until={F.session - 16} />
      </Sequence>

      {/* the session, with the decisions on the conveyor beside it */}
      <Sequence from={F.session - 8} durationInFrames={F.result - F.session + 16} layout="none">
        <SceneTime.Provider value={{ scale: 1, total: (F.result - F.session) / fps, shift: 300, dist: 1.45 }}>
          <AbsoluteFill style={{ opacity: Math.min(1, (f - F.session + 8) / 12) }}>
            <Conveyor loop={false} fps={fps} />
          </AbsoluteFill>
        </SceneTime.Provider>
      </Sequence>
      {f >= F.session - 6 && f < F.result + 12 && (
        <AbsoluteFill style={{ padding: '170px 0 0 50px' }}>
          <Reveal at={F.session - 6} until={F.result} kind="swing" exit="through" blur={8}>
            <div style={{ transform: 'perspective(2400px) rotateY(10deg)', transformOrigin: '0% 50%' }}>
              <Terminal title="your project" blocks={session(F.session + 6)} width={770} height={540} fontSize={18} />
            </div>
          </Reveal>
        </AbsoluteFill>
      )}
      <Caption at={F.session + 4} until={F.session + beats(9)} step={1}>
        The agent changes; <b style={{ color: C.cyan }}>&nbsp;Spectra decides</b>
      </Caption>
      <Caption at={F.session + beats(9) + 4} until={F.result - 6} step={2}>
        Kept only if your checks pass and it measures faster
      </Caption>

      {/* the measured result */}
      <Sequence from={F.result} durationInFrames={F.bench - F.result + 12}>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Reveal at={0} until={F.bench - F.result - 10} kind="none" exit="through" blur={12}>
            <Panel at={2} style={{ width: 1400 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 10 }}>
                <Reveal at={8} kind="pop" blur={0}>
                  <Verdict at={8}>KEPT · IMPROVED</Verdict>
                </Reveal>
                <span style={{ font: `500 28px ${fonts.ui}`, color: C.dim }}>confidence: medium · checks passed: npm test</span>
              </div>
              <StatRows
                at={12}
                width={1292}
                rows={[
                  { label: 'JavaScript CPU time', before: '1.57 s', after: '152 ms', delta: '−90%' },
                  { label: 'Row (src/Row.jsx) render time', before: '1.44 s', after: '35.3 ms', delta: '−98%' },
                ]}
              />
              <Reveal at={70}>
                <div style={{ marginTop: 12, font: `500 26px ${fonts.mono}`, color: C.dim }}>
                  committed on <span style={{ color: '#8ff0c4' }}>spectra/fix-…</span> as 7cae6fa, with the evidence in its message
                </div>
              </Reveal>
            </Panel>
          </Reveal>
        </AbsoluteFill>
      </Sequence>

      {/* the test bench */}
      <Sequence from={F.bench} durationInFrames={F.end - F.bench + 12}>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Reveal at={0} until={F.end - F.bench - 10} kind="none" exit="through" blur={12}>
            <Panel at={2} style={{ width: 1300 }}>
              <div style={{ font: `700 44px ${fonts.display}`, color: '#fff', letterSpacing: '-0.02em' }}>The test bench, in CI on every change</div>
              <div style={{ marginTop: 22, display: 'grid', gap: 12 }}>
                {BENCH.map(([id, outcome, what], i) => (
                  <Reveal key={id} at={10 + i * 8} kind="flip" blur={4}>
                    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 340px 60px', alignItems: 'center', gap: 16, padding: '14px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.line}` }}>
                      <span style={{ font: `600 26px ${fonts.mono}`, color: '#c9bcff' }}>{id}</span>
                      <span style={{ font: `500 26px ${fonts.ui}`, color: C.dim }}>{what}</span>
                      <span style={{ font: `600 26px ${fonts.ui}`, color: i === 0 ? C.green : '#ffb3c1' }}>{outcome}</span>
                      <span style={{ font: `700 30px ${fonts.ui}`, color: C.green }}>✓</span>
                    </div>
                  </Reveal>
                ))}
              </div>
              <Reveal at={52}>
                <div style={{ marginTop: 18, font: `600 30px ${fonts.ui}`, color: C.green }}>4/4 cases decided correctly</div>
              </Reveal>
            </Panel>
          </Reveal>
        </AbsoluteFill>
      </Sequence>

      <Sequence from={F.end}>
        <EndCard name="AI fix harness" badges={['Your checks first', 'Proven by measurement', 'A branch to review']} install={['npx spectra fix']} footer="New in Spectra 0.4.0 · github.com/progen-labs/spectra" />
      </Sequence>
      <Grain />

      <Music name="fix-harness" duration={DURATION} />
      <Sfx name="whoosh" at={F.session - 18} volume={0.5} />
      <Sfx name="impact" at={F.result} volume={0.5} />
      <Sfx name="whoosh" at={F.bench - 10} volume={0.4} />
      {BENCH.map((_, i) => (
        <Sfx key={i} name="pop" at={F.bench + 10 + i * 8} volume={0.2} />
      ))}
      <Sfx name="chime" at={F.bench + 52} volume={0.4} />
      <Sfx name="whoosh" at={F.end - 10} volume={0.4} />
    </AbsoluteFill>
  );
};
