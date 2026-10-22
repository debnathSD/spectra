import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Background, Grain } from '../components/Background.jsx';
import { Caption } from '../components/Caption.jsx';
import { EndCard, TitleCard } from '../components/Cards.jsx';
import { Reveal } from '../components/motion.jsx';
import { Music, Sfx } from '../components/Sound.jsx';
import { Lines, Terminal, Typed } from '../components/Terminal.jsx';
import { C, beats, fonts } from '../theme.js';
// what the footage shows: the real dashboard, the real login page, the real CLI output
// (scripts/record-signin.mjs)
import FACTS from '../../public/signin/signin.json';

// the timeline, in beats of the music
const F = Object.fromEntries(Object.entries({ panel: 6, app: 18, methods: 30, cli: 44, safety: 56, end: 66 }).map(([k, v]) => [k, beats(v)]));
export const DURATION = beats(76);
export const SIGNIN_PROPS = { musicEnd: F.end, poster: F.panel + beats(7) };

const shot = name => staticFile(`signin/${name}.png`);
const mono = (size, color = C.ink, weight = 400) => ({ font: `${weight} ${size}px ${fonts.mono}`, color });

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

// screenshots that crossfade into each other, top-aligned: [[name, from], …]
const Slides = ({ slides, width }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: 'relative', width, height: '100%' }}>
      {slides.map(([name, from], i) => {
        const next = slides[i + 1]?.[1];
        if (next != null && f > next + 10) return null; // covered by the next one
        const opacity = i === 0 ? 1 : interpolate(f, [from - 10, from], [0, 1], clamp);
        return opacity > 0 ? <Img key={name} src={shot(name)} style={{ position: 'absolute', left: 0, top: 0, width, opacity }} /> : null;
      })}
    </div>
  );
};

// how tall the frame around them is: it grows and shrinks with each screenshot, like the real panel
const useHeight = (slides, k) => {
  const f = useCurrentFrame();
  let h = FACTS.shots[slides[0][0]].height;
  for (const [name, from] of slides.slice(1)) h = interpolate(f, [from - 10, from + 4], [h, FACTS.shots[name].height], clamp);
  return h * k;
};

// a glowing ring around part of a screenshot (css px of the shot, times k)
const Ring = ({ x, y, w, h, k, at, until }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: f - at, fps, config: { damping: 14, stiffness: 180 } }) - (until ? spring({ frame: f - until, fps, config: { damping: 30 } }) : 0);
  if (a <= 0.01) return null;
  const pulse = 0.5 + 0.5 * Math.sin((f - at) / 9);
  return (
    <div
      style={{
        position: 'absolute',
        left: x * k - 10,
        top: y * k - 10,
        width: w * k + 20,
        height: h * k + 20,
        borderRadius: 16,
        border: `3px solid rgba(54,214,255,${a})`,
        boxShadow: `0 0 ${24 + pulse * 26}px rgba(54,214,255,${0.55 * a}), inset 0 0 18px rgba(54,214,255,${0.25 * a})`,
        transform: `scale(${1.25 - 0.25 * Math.min(1, a)})`,
        opacity: Math.min(1, a),
      }}
    />
  );
};

// a slow 3D drift for a whole scene
const useDrift = (rx0, ry0) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: f, fps, config: { damping: 26, stiffness: 90 } });
  const t = f / 60;
  return `perspective(2200px) rotateX(${rx0 * (1.6 - 0.6 * a) + Math.sin(t * 0.8) * 1}deg) rotateY(${ry0 * (1.6 - 0.6 * a) + Math.sin(t * 0.6) * 1.6}deg)`;
};

const frame = {
  borderRadius: 22,
  overflow: 'hidden',
  border: '1px solid rgba(140,180,255,0.3)',
  boxShadow: '0 50px 140px rgba(0,0,0,0.7), 0 0 70px rgba(54,170,255,0.14)',
};

// 1. the dashboard: turn it on, fill it in
const PANEL_W = 1560;
const PK = PANEL_W / FACTS.shots['form-filled'].width;
const Panel = () => {
  const drift = useDrift(7, -5);
  const at = { on: beats(2.5), user: beats(5), pass: beats(7), launch: beats(9.5) };
  const slides = [['connect', 0], ['form-empty', at.on + 6], ['form-filled', at.pass]];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 70 }}>
      <div style={{ transform: drift }}>
        <div style={{ ...frame, position: 'relative', width: PANEL_W, height: useHeight(slides, PK) }}>
          <Slides width={PANEL_W} slides={slides} />
          <div style={{ position: 'absolute', inset: 0 }}>
            <Ring k={PK} x={18} y={133} w={200} h={40} at={at.on - 4} until={at.user} />
            <Ring k={PK} x={22} y={318} w={440} h={38} at={at.user} until={at.launch} />
            <Ring k={PK} x={904} y={88} w={124} h={36} at={at.launch} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// 2. Spectra signs in through the app's own login page
const STEPS = [
  [0, 'The app sent Spectra to /login'],
  [beats(2), 'Found the email and password fields'],
  [beats(3.5), 'Typed them in and pressed Sign in'],
  [beats(6.5), 'Back on the page, signed in'],
];
const AppScene = () => {
  const f = useCurrentFrame();
  const drift = useDrift(5, 6);
  const typed = beats(3.5);
  const welcome = beats(6.5);
  const url = f < welcome ? `127.0.0.1:5291/login?next=%2Fapp` : `127.0.0.1:5291/app`;
  const appW = 700;
  const stripW = 1480;
  const sk = stripW / FACTS.shots['signed-in'].width;
  const strip = [['signing-in', 0], ['signed-in', welcome + 6]];
  const stripH = useHeight(strip, sk);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 90 }}>
      <div style={{ transform: drift, display: 'grid', gap: 34, justifyItems: 'center' }}>
        <div style={{ display: 'flex', gap: 70, alignItems: 'center' }}>
          <Reveal at={0} kind="swing" blur={8}>
            <div style={{ ...frame, width: appW, background: '#f1f3fa' }}>
              <div style={{ height: 50, display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px', background: '#e3e7f1', borderBottom: '1px solid #d3d9e8' }}>
                {['#ff5f57', '#febc2e', '#28c840'].map(c => (
                  <span key={c} style={{ width: 13, height: 13, borderRadius: '50%', background: c }} />
                ))}
                <span style={{ marginLeft: 14, flex: 1, padding: '6px 16px', borderRadius: 9, background: '#fff', ...mono(18, '#4a5470') }}>{url}</span>
              </div>
              <div style={{ height: (appW * 620) / 760 }}>
                <Slides width={appW} slides={[['app-login', 0], ['app-typed', typed], ['app-welcome', welcome]]} />
              </div>
            </div>
          </Reveal>
          <div style={{ width: 640, display: 'grid', gap: 22 }}>
            {STEPS.map(([at, text], i) => {
              const done = f >= (STEPS[i + 1]?.[0] ?? welcome + 20);
              return (
                <Reveal key={text} at={at + 6} kind="left" dist={30} blur={4}>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center', padding: '22px 26px', borderRadius: 20, background: 'linear-gradient(160deg, rgba(26,32,60,0.92), rgba(10,13,28,0.95))', border: `1px solid ${done ? 'rgba(70,226,160,0.45)' : 'rgba(140,180,255,0.3)'}`, boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
                    <span style={{ flex: 'none', width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center', background: done ? 'rgba(70,226,160,0.16)' : 'rgba(54,214,255,0.14)', color: done ? C.green : C.cyan, font: `700 24px ${fonts.ui}` }}>{done ? '✓' : i + 1}</span>
                    <span style={{ font: `600 29px ${fonts.ui}`, color: '#fff', letterSpacing: '-0.01em' }}>{text}</span>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
        <Reveal at={8} kind="up" dist={30}>
          <div style={{ ...frame, borderRadius: 16, height: stripH }}>
            <Slides width={stripW} slides={strip} />
          </div>
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};

// 3. every kind of login, each with its real panel
const METHODS = [
  ['form-filled', 'Login form', 'One step or two, iframes, web components, any identity provider, authenticator codes'],
  ['method-manual', 'I’ll sign in myself', 'SMS or email codes, passkeys, push approvals, CAPTCHAs'],
  ['method-http', 'Browser prompt', 'HTTP Basic or Digest, as on many staging servers'],
  ['method-token', 'Token or cookie', 'A header, cookies or localStorage entries'],
  ['method-link', 'Sign-in link', 'A URL that signs in by itself'],
];
const EACH = beats(2.6);
const Methods = () => {
  const f = useCurrentFrame();
  const drift = useDrift(6, -6);
  const active = Math.min(METHODS.length - 1, Math.max(0, Math.floor((f - 10) / EACH)));
  const shotW = 1220;
  const k = shotW / FACTS.shots['form-filled'].width;
  const slides = METHODS.map(([name], i) => [name, 10 + i * EACH]);
  const height = useHeight(slides, k);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
      <div style={{ transform: drift, display: 'flex', gap: 46, alignItems: 'center' }}>
        <div style={{ width: 540, display: 'grid', gap: 16 }}>
          {METHODS.map(([, title, hint], i) => (
            <Reveal key={title} at={4 + i * 3} kind="left" dist={30} blur={4}>
              <div style={{ padding: '20px 26px', borderRadius: 20, background: i === active ? 'linear-gradient(135deg, rgba(10,132,255,0.32), rgba(191,90,242,0.22))' : 'rgba(14,18,34,0.85)', border: `1px solid ${i === active ? 'rgba(54,214,255,0.7)' : 'rgba(255,255,255,0.1)'}`, boxShadow: i === active ? '0 0 40px rgba(54,170,255,0.3)' : 'none', transform: `scale(${i === active ? 1.03 : 1})` }}>
                <div style={{ font: `700 30px ${fonts.ui}`, color: '#fff' }}>{title}</div>
                <div style={{ marginTop: 6, font: `500 20px ${fonts.ui}`, color: i === active ? C.ink : C.faint }}>{hint}</div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal at={10} kind="depth" blur={8}>
          <div style={{ ...frame, width: shotW, height, background: 'rgba(12,16,32,0.95)' }}>
            <Slides width={shotW} slides={slides} />
          </div>
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};

// 4. the command line, as it ran
const CLI = () => {
  const drift = useDrift(6, 5);
  const [envPart, ...rest] = FACTS.cli.command.split(' npx ');
  const cmd = `npx ${rest.join(' npx ')}`;
  const split = cmd.indexOf(' --url');
  const typedAt = 12;
  const outAt = typedAt + beats(4.5);
  const lines = FACTS.cli.lines.map(l => {
    if (/^spectra: signed in/.test(l)) return <span style={{ color: C.green }}>{l}</span>;
    if (/^spectra:/.test(l)) return <span style={{ color: C.amber }}>{l}</span>;
    if (/^Saved /.test(l)) return <span style={{ color: C.faint }}>{l}</span>;
    return l;
  });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
      <div style={{ transform: drift, display: 'grid', gap: 26, justifyItems: 'center' }}>
        <Terminal
          title="~/acme-store"
          width={1560}
          height={560}
          fontSize={23}
          blocks={[
            {
              at: typedAt,
              lines: 2,
              el: (
                <>
                  <div style={{ whiteSpace: 'pre', height: 43 }}>
                    <span style={{ color: C.cyan }}>$ </span>
                    <span style={{ color: C.violet }}>{envPart} </span>
                    <Typed text={cmd.slice(0, split) + ' \\'} at={typedAt} cps={70} />
                  </div>
                  <div style={{ whiteSpace: 'pre', height: 43 }}>
                    {'    '}
                    <Typed text={cmd.slice(split + 1)} at={typedAt + ((split + 2) * 60) / 70} cps={70} />
                  </div>
                </>
              ),
            },
            { at: outAt, lines: lines.length, el: <Lines at={outAt} step={beats(0.5)}>{lines}</Lines> },
          ]}
        />
        <Reveal at={outAt + beats(4)} kind="flip" blur={4}>
          <div style={{ display: 'flex', gap: 30, alignItems: 'center', padding: '20px 30px', borderRadius: 20, background: 'rgba(12,16,32,0.92)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <span style={{ font: `600 24px ${fonts.ui}`, color: C.dim }}>Or once, in spectra.config.json:</span>
            <span style={{ ...mono(22, '#9df3cb') }}>{'"signIn": { "url": "…/login", "username": "me@example.com" }'}</span>
          </div>
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};

// 5. secrets stay secret
const SAFETY = [
  ['In memory only', 'Never written to disk, a log, a report or an error message'],
  ['Never in a file', 'spectra.config.json refuses them: secrets come from the environment'],
  ['Your origin only', 'A token header goes to the app, never to third parties'],
  ['No CAPTCHA solving', 'Spectra stops and hands the window over to you'],
];
const Safety = () => {
  const drift = useDrift(8, 6);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 40 }}>
      <div style={{ transform: drift }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 760px)', gap: 28 }}>
          {SAFETY.map(([title, detail], i) => (
            <Reveal key={title} at={2 + i * 4} kind="flip" blur={6}>
              <div style={{ display: 'flex', gap: 26, alignItems: 'flex-start', height: 170, padding: '32px 36px', borderRadius: 24, background: 'linear-gradient(160deg, rgba(20,48,44,0.6), rgba(10,14,26,0.95))', border: '1px solid rgba(70,226,160,0.4)', boxShadow: '0 30px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
                <span style={{ flex: 'none', width: 58, height: 58, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'rgba(70,226,160,0.16)', color: C.green, font: `700 32px ${fonts.ui}`, boxShadow: '0 0 30px rgba(70,226,160,0.35)' }}>✓</span>
                <div>
                  <div style={{ font: `700 34px ${fonts.ui}`, color: '#fff' }}>{title}</div>
                  <div style={{ marginTop: 10, font: `500 25px ${fonts.ui}`, color: C.dim }}>{detail}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// each scene arrives quickly and leaves by flying past the camera
const Scene = ({ from, to, children }) => (
  <Sequence from={from} durationInFrames={to - from + 12}>
    <Reveal at={-30} until={to - from - 8} kind="none" exit="through" blur={12} style={{ position: 'absolute', inset: 0 }}>
      {children}
    </Reveal>
  </Sequence>
);

export const SignIn = () => {
  const captions = [
    [F.panel + 4, F.app - 8, 1, <>Turn on “My app needs a sign-in”</>],
    [F.app + 4, F.methods - 8, 2, <>Spectra signs in through your app’s own login page</>],
    [F.methods + 4, F.cli - 8, 3, <>Every kind of login</>],
    [F.cli + 4, F.safety - 8, 4, <>On the command line and in CI</>],
    [F.safety + 4, F.end - 8, 5, <>Secrets stay secret</>],
  ];
  return (
    <AbsoluteFill>
      <Background />
      <Sequence durationInFrames={F.panel + 10}>
        <TitleCard kicker="Spectra · Signing in" words={['Profile', 'the', 'pages', '|', 'behind', 'your', 'login']} accent={[4, 5, 6]} sub="Chrome starts signed out. Spectra signs in first, then measures." until={F.panel - 16} />
      </Sequence>
      <Scene from={F.panel} to={F.app}>
        <Panel />
      </Scene>
      <Scene from={F.app} to={F.methods}>
        <AppScene />
      </Scene>
      <Scene from={F.methods} to={F.cli}>
        <Methods />
      </Scene>
      <Scene from={F.cli} to={F.safety}>
        <CLI />
      </Scene>
      <Scene from={F.safety} to={F.end}>
        <Safety />
      </Scene>
      {captions.map(([at, until, step, body]) => (
        <Caption key={at} at={at} until={until} step={step}>
          {body}
        </Caption>
      ))}
      <Sequence from={F.end}>
        <EndCard name="Signing in" badges={['Login forms', 'SSO', 'Authenticator codes', 'Tokens and cookies']} install={['npx spectra dashboard']} />
      </Sequence>
      <Grain />

      <Music name="signing-in" duration={DURATION} />
      {[F.panel, F.app, F.methods, F.cli, F.safety, F.end].map(at => (
        <Sfx key={at} name="whoosh" at={at - 12} volume={0.45} />
      ))}
      {captions.map(([at]) => (
        <Sfx key={at} name="tick" at={at} volume={0.2} />
      ))}
      <Sfx name="pop" at={F.panel + beats(2.5)} volume={0.25} />
      <Sfx name="chime" at={F.app + beats(6)} volume={0.4} />
      {METHODS.map((m, i) => (
        <Sfx key={m[0]} name="tick" at={F.methods + 10 + i * EACH} volume={0.14} />
      ))}
      <Sfx name="chime" at={F.cli + 12 + beats(4.5) + beats(0.5)} volume={0.3} />
    </AbsoluteFill>
  );
};
