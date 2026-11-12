// Tiny WebAudio blips. Off until the sound button is clicked (browsers need a user gesture).
let ac = null, on = false;

function tone(f, dur, type = 'square', vol = 0.03, slide = 0) {
  if (!on || !ac) return;
  const o = ac.createOscillator(), v = ac.createGain();
  o.type = type; o.frequency.value = f;
  if (slide) o.frequency.linearRampToValueAtTime(f + slide, ac.currentTime + dur);
  v.gain.setValueAtTime(vol, ac.currentTime);
  v.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  o.connect(v).connect(ac.destination);
  o.start(); o.stop(ac.currentTime + dur);
}

export const sfx = {
  toggle() {
    on = !on;
    if (on && !ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (on && ac.state === 'suspended') ac.resume();
    if (on) tone(660, 0.08, 'triangle', 0.05);
    return on;
  },
  step() { tone(70 + Math.random() * 25, 0.04, 'square', 0.015); },
  ping() { tone(880, 0.12, 'triangle', 0.06); setTimeout(() => tone(1320, 0.18, 'triangle', 0.06), 110); },
  portal() { tone(180, 0.35, 'sawtooth', 0.02, 320); },
};
