#!/usr/bin/env node
// Deterministic offline synth — composes the Novus B2C promo track.
// 84s, 120 BPM (2s bars), D minor. Sections mirror the storyboard:
//   bars  0-3   (0-8s)   A  minimal search-hook groove
//   bars  4-6   (8-14s)  B  drop 1 — brand reveal
//   bars  7-10  (14-22s) C  groove + arp (product reveal)
//   bars 11-15  (22-32s) D  full energy (gameplay loop)
//   bars 16-19  (32-40s) E  variation (life-sim montage)
//   bars 20-21  (40-44s) F  breakdown (mid-hook)
//   bars 22-27  (44-56s) G  dark halftime tension (the tank / pitch)
//   bars 28-31  (56-64s) H  bright return (level up)
//   bars 32-34  (64-70s) I  full groove (UI montage)
//   bars 35-37  (70-76s) J  final build (riser + roll)
//   bars 38-41  (76-84s) K  peak, hit at 80, ring-out
import { writeFileSync } from "node:fs";

const SR = 44100;
const BPM = 120;
const BEAT = 60 / BPM; // 0.5s
const BAR = BEAT * 4; // 2s
const DUR = 84;
const N = Math.ceil(DUR * SR);
const L = new Float64Array(N);
const R = new Float64Array(N);

// deterministic PRNG
let seed = 0x9e3779b9;
function rnd() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0xffffffff;
}
const noiseBuf = new Float64Array(SR * 2);
for (let i = 0; i < noiseBuf.length; i++) noiseBuf[i] = rnd() * 2 - 1;

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
// chords as midi roots: D minor world
const Dm = [50, 53, 57, 62]; // D3 F3 A3 D4
const Bb = [46, 50, 53, 58];
const F = [45, 48, 53, 57]; // A2? — use F3 A3 C4 F4 => 53,57,60,65 too high; keep low voicing
const Fv = [41, 48, 53, 57];
const C = [48, 52, 55, 60];
const Gm = [43, 50, 55, 58];
const A7 = [45, 49, 55, 61];
const barChord = (bar) => {
  if (bar >= 20 && bar <= 21) return [Dm, Bb][bar - 20];
  if (bar >= 22 && bar <= 27) return [Dm, Dm, Gm, Gm, A7, A7][bar - 22];
  if (bar >= 28 && bar <= 31) return [Bb, Fv, C, Dm][bar - 28];
  if (bar >= 38) return [Dm, Bb, Fv, Dm][bar - 38] || Dm;
  return [Dm, Bb, Fv, C][bar % 4];
};
const bassNote = (bar) => barChord(bar)[0] - 12; // root, one octave down

// ---- section helpers ----
const S = (t) => Math.floor(t / BAR); // bar index at time t
const inRange = (bar, a, b) => bar >= a && bar <= b;
const drums1 = (bar) => inRange(bar, 4, 19) || inRange(bar, 28, 37) || inRange(bar, 38, 39);
const darkSec = (bar) => inRange(bar, 22, 27);
const minimal = (bar) => inRange(bar, 0, 3);
const breakdown = (bar) => inRange(bar, 20, 21);
const outro = (bar) => bar >= 40;

// ---- voices ----
function addKick(t, amp = 1) {
  const n0 = Math.floor(t * SR);
  const len = Math.floor(0.32 * SR);
  for (let i = 0; i < len && n0 + i < N; i++) {
    const tt = i / SR;
    const f = 42 + 110 * Math.exp(-tt * 38);
    const env = Math.exp(-tt * 13);
    const click = i < 90 ? (1 - i / 90) * 0.5 * noiseBuf[i % noiseBuf.length] : 0;
    const s = (Math.sin(2 * Math.PI * f * tt) * env + click) * 0.9 * amp;
    L[n0 + i] += s;
    R[n0 + i] += s;
  }
  kicks.push(t);
}
const kicks = [];

function addHat(t, open = false, amp = 0.16) {
  const n0 = Math.floor(t * SR);
  const len = Math.floor((open ? 0.22 : 0.05) * SR);
  let hp = 0;
  for (let i = 0; i < len && n0 + i < N; i++) {
    const w = noiseBuf[(n0 + i) % noiseBuf.length];
    hp = 0.72 * hp + w - (i > 0 ? noiseBuf[(n0 + i - 1) % noiseBuf.length] : 0) * 0.98;
    const env = Math.exp((-i / SR) * (open ? 22 : 90));
    const s = hp * env * amp;
    L[n0 + i] += s * 0.8;
    R[n0 + i] += s * 1.0;
  }
}

function addClap(t, amp = 0.34) {
  for (let k = 0; k < 3; k++) {
    const n0 = Math.floor((t + k * 0.012) * SR);
    const len = Math.floor(0.16 * SR);
    let bp = 0,
      bp2 = 0;
    for (let i = 0; i < len && n0 + i < N; i++) {
      const w = noiseBuf[(n0 + i * 3) % noiseBuf.length];
      bp = 0.86 * bp + w * 0.35;
      bp2 = 0.55 * bp2 + bp;
      const env = Math.exp((-i / SR) * 34);
      const s = (bp - bp2 * 0.4) * env * amp * (k === 2 ? 1 : 0.55);
      L[n0 + i] += s * 1.0;
      R[n0 + i] += s * 0.85;
    }
  }
}

function addBass(t, m, dur, amp = 0.34, cutoff = 0.16) {
  const n0 = Math.floor(t * SR);
  const len = Math.floor(dur * SR);
  const f = midi(m);
  let lp = 0,
    lp2 = 0;
  let ph = 0,
    phSub = 0;
  for (let i = 0; i < len && n0 + i < N; i++) {
    const tt = i / SR;
    ph += f / SR;
    phSub += (f / 2) * (1 / SR) * 2; // same f, sine sub
    const saw = 2 * (ph - Math.floor(ph + 0.5));
    lp += cutoff * (saw - lp);
    lp2 += cutoff * (lp - lp2);
    const sub = Math.sin(2 * Math.PI * f * tt) * 0.55;
    const env = Math.min(1, tt / 0.005) * Math.exp(-tt * 7);
    const s = (lp2 * 0.9 + sub) * env * amp;
    L[n0 + i] += s;
    R[n0 + i] += s;
  }
}

function addStab(t, chord, dur = 0.22, amp = 0.16, bright = 0.25) {
  const n0 = Math.floor(t * SR);
  const len = Math.floor(dur * SR);
  const phases = chord.map(() => [0, 0]);
  let lp = 0;
  for (let i = 0; i < len && n0 + i < N; i++) {
    const tt = i / SR;
    let v = 0;
    for (let c = 0; c < chord.length; c++) {
      const f = midi(chord[c] + 12);
      phases[c][0] += (f * 0.997) / SR;
      phases[c][1] += (f * 1.003) / SR;
      v += 2 * (phases[c][0] - Math.floor(phases[c][0] + 0.5));
      v += 2 * (phases[c][1] - Math.floor(phases[c][1] + 0.5));
    }
    v /= chord.length * 2;
    lp += bright * (v - lp);
    const env = Math.min(1, tt / 0.004) * Math.exp(-tt * 16);
    const s = lp * env * amp;
    L[n0 + i] += s * (i % 2 ? 1 : 0.9);
    R[n0 + i] += s * (i % 2 ? 0.9 : 1);
  }
}

function addPluck(t, m, dur = 0.18, amp = 0.12, pan = 0.5) {
  const n0 = Math.floor(t * SR);
  const len = Math.floor(dur * SR);
  const f = midi(m);
  let lp = 0;
  let ph = 0;
  for (let i = 0; i < len && n0 + i < N; i++) {
    const tt = i / SR;
    ph += f / SR;
    const sq = Math.sign(Math.sin(2 * Math.PI * ph)) * 0.6 + Math.sin(2 * Math.PI * ph * 2) * 0.4;
    lp += 0.38 * (sq - lp);
    const env = Math.min(1, tt / 0.003) * Math.exp(-tt * 24);
    const s = lp * env * amp;
    L[n0 + i] += s * (1 - pan);
    R[n0 + i] += s * pan;
  }
}

function addPad(t, chord, dur, amp = 0.075) {
  const n0 = Math.floor(t * SR);
  const len = Math.floor(dur * SR);
  const phases = chord.map(() => [0, 0]);
  let lp = 0;
  for (let i = 0; i < len && n0 + i < N; i++) {
    const tt = i / SR;
    let v = 0;
    for (let c = 0; c < chord.length; c++) {
      const f = midi(chord[c] + 12);
      phases[c][0] += (f * 0.995) / SR;
      phases[c][1] += (f * 1.005) / SR;
      v += 2 * (phases[c][0] - Math.floor(phases[c][0] + 0.5));
      v += 2 * (phases[c][1] - Math.floor(phases[c][1] + 0.5));
    }
    v /= chord.length * 2;
    lp += 0.045 * (v - lp);
    const a = Math.min(1, tt / 0.6) * Math.min(1, (dur - tt) / 0.8);
    const s = lp * a * amp;
    L[n0 + i] += s * 0.95;
    R[n0 + i] += s * 1.05;
  }
}

function addRiser(t, dur, amp = 0.2) {
  const n0 = Math.floor(t * SR);
  const len = Math.floor(dur * SR);
  let lp = 0;
  for (let i = 0; i < len && n0 + i < N; i++) {
    const p = i / len;
    const w = noiseBuf[(n0 + i * 7) % noiseBuf.length];
    lp += (0.02 + 0.5 * p * p) * (w - lp);
    const s = lp * p * p * amp;
    const sw = Math.sin(2 * Math.PI * (200 + 900 * p * p) * (i / SR)) * 0.12 * p;
    L[n0 + i] += (s + sw) * (0.8 + 0.2 * Math.sin(p * 40));
    R[n0 + i] += (s + sw) * (0.8 - 0.2 * Math.sin(p * 40));
  }
}

function addImpact(t, amp = 0.9) {
  const n0 = Math.floor(t * SR);
  const len = Math.floor(1.1 * SR);
  let lp = 0;
  for (let i = 0; i < len && n0 + i < N; i++) {
    const tt = i / SR;
    const f = 36 + 70 * Math.exp(-tt * 10);
    const boom = Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 4.2);
    const w = noiseBuf[(n0 + i * 5) % noiseBuf.length];
    lp += 0.06 * (w - lp);
    const s = (boom * 0.9 + lp * Math.exp(-tt * 9) * 0.5) * amp;
    L[n0 + i] += s;
    R[n0 + i] += s;
  }
}

function addRoll(t0, dur) {
  // accelerating snare roll across [t0, t0+dur]
  let t = t0;
  let step = 0.25; // beat fractions in seconds at 120bpm: 0.25 = 8ths
  while (t < t0 + dur) {
    const p = (t - t0) / dur;
    addClap(t, 0.1 + 0.3 * p);
    step = p < 0.45 ? 0.25 : p < 0.8 ? 0.125 : 0.0625;
    t += step;
  }
}

// ---- arrangement ----
const NBARS = Math.floor(DUR / BAR);
for (let bar = 0; bar < NBARS; bar++) {
  const t0 = bar * BAR;
  const ch = barChord(bar);
  const bn = bassNote(bar);

  // PADS: everywhere except outro tail; quiet in minimal, big in breakdown
  if (bar < 40) {
    const amp = minimal(bar) ? 0.085 : breakdown(bar) ? 0.12 : darkSec(bar) ? 0.07 : 0.075;
    addPad(t0, ch, BAR + 0.4, amp);
  }

  // MINIMAL section: pluck arp + soft hats
  if (minimal(bar)) {
    const seq = [0, 2, 1, 3, 0, 2, 3, 1];
    for (let s8 = 0; s8 < 8; s8++) {
      addPluck(t0 + s8 * (BEAT / 2), ch[seq[s8]] + 12, 0.16, 0.13, s8 % 2 ? 0.62 : 0.38);
    }
    if (bar >= 1) for (let b = 0; b < 8; b++) addHat(t0 + b * (BEAT / 2), false, 0.11);
    if (bar >= 2) addBass(t0, bn, 0.9, 0.24, 0.08);
    addBass(t0 + 2 * BEAT, bn, 0.9, 0.24, 0.08);
  }

  // MAIN groove sections
  if (drums1(bar)) {
    for (let b = 0; b < 4; b++) addKick(t0 + b * BEAT, b === 0 ? 1 : 0.92);
    addClap(t0 + BEAT, 0.3);
    addClap(t0 + 3 * BEAT, 0.3);
    for (let s16 = 0; s16 < 16; s16++)
      addHat(t0 + s16 * (BEAT / 4), false, s16 % 4 === 2 ? 0.15 : 0.08);
    addHat(t0 + 2 * BEAT + BEAT / 2, true, 0.1);
    // bass: 8ths with octave pops
    for (let s8 = 0; s8 < 8; s8++) {
      const oct = s8 === 3 || s8 === 7 ? 12 : 0;
      addBass(t0 + s8 * (BEAT / 2), bn + oct, 0.21, 0.3, inRange(bar, 11, 19) ? 0.22 : 0.16);
    }
    // stabs offbeat
    addStab(t0 + BEAT / 2, ch, 0.2, 0.15);
    addStab(t0 + 2.5 * BEAT, ch, 0.2, 0.15);
    if (bar % 2 === 1) addStab(t0 + 3.5 * BEAT, ch, 0.16, 0.12);
    // arp melody in C/E/H/I sections
    if (inRange(bar, 7, 10) || inRange(bar, 16, 19) || inRange(bar, 28, 37)) {
      const seq = [3, 2, 3, 1, 3, 2, 0, 2, 3, 2, 3, 1, 3, 0, 2, 1];
      for (let s16 = 0; s16 < 16; s16++)
        addPluck(t0 + s16 * (BEAT / 4), ch[seq[s16]] + 24, 0.11, 0.05, s16 % 2 ? 0.7 : 0.3);
    }
  }

  // BREAKDOWN
  if (breakdown(bar)) {
    for (let s8 = 0; s8 < 8; s8++) addBass(t0 + s8 * (BEAT / 2), bn, 0.2, 0.13, 0.06);
    addStab(t0, ch, 0.5, 0.1, 0.1);
  }

  // DARK halftime (the tank)
  if (darkSec(bar)) {
    addKick(t0, 0.95);
    addKick(t0 + 2 * BEAT + BEAT / 2, 0.8);
    addClap(t0 + 2 * BEAT, 0.26);
    for (let s16 = 0; s16 < 16; s16++)
      addHat(t0 + s16 * (BEAT / 4), false, s16 % 4 === 0 ? 0.05 : 0.035);
    for (const off of [0, 0.75, 1.5, 2, 2.75, 3.5]) addBass(t0 + off * BEAT, bn, 0.34, 0.34, 0.09);
    if (bar % 2 === 0) addStab(t0 + 3 * BEAT, ch, 0.3, 0.09, 0.12);
  }

  // FINAL BUILD J (bars 35-37)
  if (inRange(bar, 35, 37)) {
    // kick every beat already via drums1? drums1 covers 28-37 -> yes. Add roll + riser on 36-37.
  }

  // OUTRO K: bars 40-41 ring-out handled after loop
}

// section punctuation
addImpact(8.0, 0.95); // drop 1 / brand reveal
addRiser(6.2, 1.8, 0.16);
addRiser(12.5, 1.5, 0.13);
addImpact(22.0, 0.6);
addImpact(32.0, 0.6);
addRiser(38.5, 1.5, 0.14);
addImpact(40.0, 0.7); // breakdown slam
addRiser(42.0, 2.0, 0.2);
addImpact(44.0, 0.95); // tank arrival
addImpact(56.0, 0.85); // level-up return
addRiser(54.5, 1.5, 0.16);
addImpact(64.0, 0.55);
addRiser(72.0, 4.0, 0.3); // final build
addRoll(72.0, 4.0);
addImpact(76.0, 1.0); // peak
addImpact(80.0, 1.0); // CTA hit
addPad(80.0, Dm, 3.4, 0.11); // ring-out chord

// bars 38-39 (76-80) peak already covered by drums1(38,39)

// ---- sidechain pump: duck everything but kicks slightly after each kick ----
// (applied as a global gentle duck — kicks were added first at full level, so
// re-scan: simpler approach — apply duck to the summed buffer minus nothing.
// The pump reads as groove; kicks are short so they survive the duck visually.)
kicks.sort((a, b) => a - b);
let ki = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  while (ki < kicks.length - 1 && kicks[ki + 1] <= t) ki++;
  const since = t - kicks[ki];
  if (since >= 0 && since < 0.42) {
    const duck = 1 - 0.35 * Math.exp(-since * 9) * (since < 0.02 ? since / 0.02 : 1);
    L[i] *= duck;
    R[i] *= duck;
  }
}

// ---- master: HP rumble trim, soft clip, normalize, fades ----
let hpL = 0,
  hpR = 0,
  pL = 0,
  pR = 0;
for (let i = 0; i < N; i++) {
  // one-pole highpass ~28Hz
  hpL = 0.996 * (hpL + L[i] - pL);
  hpR = 0.996 * (hpR + R[i] - pR);
  pL = L[i];
  pR = R[i];
  L[i] = Math.tanh(hpL * 1.15);
  R[i] = Math.tanh(hpR * 1.15);
}
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.91 / peak;
const fadeIn = 0.03 * SR;
const fadeStart = 82.6 * SR;
for (let i = 0; i < N; i++) {
  let f = 1;
  if (i < fadeIn) f = i / fadeIn;
  if (i > fadeStart) f = Math.max(0, 1 - (i - fadeStart) / (1.35 * SR));
  L[i] *= g * f;
  R[i] *= g * f;
}

// ---- write WAV (16-bit PCM stereo) ----
const bytes = 44 + N * 4;
const buf = Buffer.alloc(bytes);
buf.write("RIFF", 0);
buf.writeUInt32LE(bytes - 8, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
}
writeFileSync(new URL("../assets/music.wav", import.meta.url), buf);
console.log("wrote assets/music.wav", (bytes / 1e6).toFixed(1), "MB");
