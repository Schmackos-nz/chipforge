'use strict';
// Rotary knob: drag up/down (Shift = fine), wheel, double-click resets.

let _knobWheelUndo = 0;
function Knob(o) {
  const dial = h('div', { class: 'dial', title: (o.title || o.label) + ' — drag, wheel, double-click to reset' }, h('div', { class: 'ind' }));
  const val = h('div', { class: 'kval' });
  const el = h('div', { class: 'knob' }, dial, val, h('div', { class: 'klab' }, o.label));
  if (o.color) dial.style.setProperty('--kc', o.color);
  let v = o.value;
  const toN = x => o.log ? Math.log(x / o.min) / Math.log(o.max / o.min) : (x - o.min) / (o.max - o.min);
  const fromN = n => {
    n = clamp(n, 0, 1);
    let x = o.log ? o.min * Math.pow(o.max / o.min, n) : o.min + n * (o.max - o.min);
    if (o.step) x = Math.round(x / o.step) * o.step;
    return +x.toFixed(6);
  };
  const fmt = o.fmt || (x => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)));
  const render = () => {
    const n = clamp(toN(v), 0, 1);
    dial.style.setProperty('--a', (n * 270) + 'deg');
    dial.firstChild.style.transform = `rotate(${-135 + n * 270}deg)`;
    val.textContent = fmt(v);
  };
  const set = nv => { if (nv !== v) { v = nv; render(); o.onInput(v); } };
  dial.addEventListener('pointerdown', e => {
    e.preventDefault();
    dial.setPointerCapture(e.pointerId);
    if (o.onStart) o.onStart();
    const y0 = e.clientY, n0 = toN(v);
    const mv = ev => set(fromN(n0 + (y0 - ev.clientY) / (ev.shiftKey ? 900 : 180)));
    const up = () => { dial.removeEventListener('pointermove', mv); dial.removeEventListener('pointerup', up); };
    dial.addEventListener('pointermove', mv);
    dial.addEventListener('pointerup', up);
  });
  dial.addEventListener('dblclick', () => { if (o.def != null) { if (o.onStart) o.onStart(); set(o.def); } });
  dial.addEventListener('wheel', e => {
    e.preventDefault();
    const now = performance.now();
    if (o.onStart && now - _knobWheelUndo > 700) o.onStart();
    _knobWheelUndo = now;
    let nv = fromN(toN(v) + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.004 : 0.025));
    if (o.step && nv === v) nv = clamp(v + (e.deltaY < 0 ? o.step : -o.step), o.min, o.max);
    set(nv);
  }, { passive: false });
  el.set = x => { v = x; render(); };
  render();
  return el;
}

const fmtHz = x => (x >= 1000 ? (x / 1000).toFixed(x >= 10000 ? 1 : 2) + 'k' : Math.round(x) + '');
const fmtSec = x => (x < 1 ? Math.round(x * 1000) + 'ms' : x.toFixed(2) + 's');
const fmtPct = x => Math.round(x * 100) + '%';
const fmtBoost = x => (x > 0.05 ? '+' + x.toFixed(1) + 'dB' : 'off');
const fmtPan = x => (Math.abs(x) < 0.02 ? 'C' : (x < 0 ? 'L' : 'R') + Math.round(Math.abs(x) * 100));
