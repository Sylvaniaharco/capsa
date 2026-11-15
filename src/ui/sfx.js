// Efek suara kecil dari WebAudio (tanpa file). Suara baru bisa keluar setelah pemain menyentuh layar.
let ctx = null;
let on = true;
export const setSound = (v) => { on = !!v; };

function tone(freq, dur, { type = 'triangle', gain = 0.07, at = 0, to = null } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const SOUNDS = {
  tap: () => tone(700, 0.04),
  swap: () => { tone(520, 0.05); tone(820, 0.07, { at: 0.05 }); },
  deal: () => { for (let i = 0; i < 6; i++) tone(240 + i * 25, 0.035, { type: 'square', gain: 0.025, at: i * 0.07 }); },
  flip: () => tone(380, 0.06, { type: 'square', gain: 0.03, to: 620 }),
  ready: () => { tone(660, 0.08); tone(990, 0.12, { at: 0.08 }); },
  tick: () => tone(1100, 0.03, { type: 'square', gain: 0.03 }),
  scoop: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, { at: i * 0.07, gain: 0.08 })); },
  win: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, { at: i * 0.09 })); },
  lose: () => { [440, 370, 311, 262].forEach((f, i) => tone(f, 0.2, { at: i * 0.12, type: 'sine' })); },
  bad: () => tone(180, 0.12, { type: 'sawtooth', gain: 0.04 }),
};

export function sfx(name) {
  if (!on) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    SOUNDS[name]?.();
  } catch { /* tidak ada audio: lewati */ }
}
