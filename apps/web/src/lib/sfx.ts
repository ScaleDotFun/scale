/**
 * PHOSPHOR sound engine — every sound is synthesized live with
 * WebAudio. No audio files, no samples: pure oscillator terminal
 * bleeps, the way 1983 intended. Off by default, persisted.
 */

const KEY = 'front_sfx';
const EVT = 'front-sfx-change';

let ctx: AudioContext | null = null;
let enabled = false;

try { enabled = localStorage.getItem(KEY) === '1'; } catch { /* ignore */ }

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function sfxEnabled(): boolean { return enabled; }

export function setSfx(on: boolean): void {
  enabled = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVT, { detail: on }));
  if (on) blip('confirm'); // audible confirmation that sound is live
}

export function onSfxChange(cb: (on: boolean) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent).detail as boolean);
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}

interface Tone {
  f0: number;
  f1?: number;
  t: number;        // duration s
  type: OscillatorType;
  gain: number;
  at?: number;      // start offset s
}

const PATCHES: Record<string, Tone[]> = {
  // Sharp key click — nav, palette moves
  click: [{ f0: 2100, f1: 1300, t: 0.03, type: 'square', gain: 0.025 }],
  // Palette / overlay open
  open: [
    { f0: 660, t: 0.045, type: 'sine', gain: 0.05 },
    { f0: 990, t: 0.05, type: 'sine', gain: 0.045, at: 0.05 },
  ],
  // Positive confirm — order ticket, sound-on
  confirm: [
    { f0: 440, t: 0.06, type: 'triangle', gain: 0.06 },
    { f0: 660, t: 0.06, type: 'triangle', gain: 0.06, at: 0.06 },
    { f0: 880, t: 0.09, type: 'triangle', gain: 0.06, at: 0.12 },
  ],
  // Liquidation alarm — three angry pulses
  alarm: [
    { f0: 220, t: 0.07, type: 'sawtooth', gain: 0.055 },
    { f0: 220, t: 0.07, type: 'sawtooth', gain: 0.055, at: 0.12 },
    { f0: 165, t: 0.12, type: 'sawtooth', gain: 0.06, at: 0.24 },
  ],
  // Degauss thump — CRT theme swap
  degauss: [
    { f0: 120, f1: 38, t: 0.28, type: 'sine', gain: 0.10 },
    { f0: 3400, f1: 300, t: 0.10, type: 'sawtooth', gain: 0.012 },
  ],
};

export type SfxName = keyof typeof PATCHES;

export function blip(name: SfxName): void {
  if (!enabled) return;
  const a = ac();
  if (!a) return;
  const now = a.currentTime;
  for (const tone of PATCHES[name]) {
    const osc = a.createOscillator();
    const g = a.createGain();
    const t0 = now + (tone.at ?? 0);
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.f0, t0);
    if (tone.f1) osc.frequency.exponentialRampToValueAtTime(tone.f1, t0 + tone.t);
    g.gain.setValueAtTime(tone.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.t);
    osc.connect(g).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + tone.t + 0.02);
  }
}
