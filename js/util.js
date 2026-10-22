'use strict';
// Small shared helpers. Everything here is global (plain scripts so index.html works from file://).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
let _uidN = 0;
function uid(p) { return (p || 'x') + (Date.now() % 1e7).toString(36) + (++_uidN).toString(36) + Math.random().toString(36).slice(2, 5); }
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function mtof(p) { return 440 * Math.pow(2, (p - 69) / 12); }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const r = mulberry32((seed >>> 0) || 1);
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.chance = p => r() < p;
  r.weighted = pairs => {
    let tot = 0;
    for (const [, w] of pairs) tot += Math.max(0, w);
    let x = r() * tot;
    for (const [it, w] of pairs) { x -= Math.max(0, w); if (x <= 0) return it; }
    return pairs[pairs.length - 1][0];
  };
  return r;
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function fmtTime(sec) { sec = Math.max(0, sec); const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m + ':' + String(s).padStart(2, '0'); }
function parseTime(str) {
  str = String(str).trim();
  const m = str.match(/^(\d+):(\d{1,2})$/);
  if (m) return +m[1] * 60 + +m[2];
  const n = parseFloat(str);
  return isNaN(n) ? null : n * 60; // bare number = minutes
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}
function safeName(s) { return (s || 'untitled').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'untitled'; }

function setStatus(m) { const s = document.getElementById('statusMsg'); if (s) s.textContent = m; }
function toast(msg, ms) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms || 2600);
  setStatus(msg);
}

function pickFile(accept) {
  return new Promise(res => {
    const inp = document.getElementById('fileInput');
    inp.value = '';
    inp.accept = accept || '';
    inp.onchange = () => res(inp.files[0] || null);
    inp.click();
  });
}
function readFile(file, as) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    if (as === 'text') fr.readAsText(file); else fr.readAsArrayBuffer(file);
  });
}
