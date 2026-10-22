'use strict';
// Standard MIDI File read/write.

const Midi = (() => {
  function parse(ab) {
    const u8 = new Uint8Array(ab), dv = new DataView(ab);
    const str = (p, n) => String.fromCharCode.apply(null, u8.subarray(p, p + n));
    if (str(0, 4) !== 'MThd') throw new Error('Not a MIDI file');
    const hlen = dv.getUint32(4), div = dv.getUint16(12);
    if (div & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
    let o = 8 + hlen;
    const tracks = [];
    let bpm = null, beats = null;
    while (o + 8 <= u8.length) {
      const id = str(o, 4), len = dv.getUint32(o + 4);
      o += 8;
      const end = Math.min(u8.length, o + len);
      if (id !== 'MTrk') { o = end; continue; }
      let t = 0, rs = 0, name = '';
      const on = new Map(), notes = [];
      const vlq = () => { let v = 0, b; do { b = u8[o++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && o < end); return v; };
      while (o < end) {
        t += vlq();
        let st = u8[o];
        if (st & 0x80) o++; else st = rs;
        if (st === 0xFF) {
          const type = u8[o++], l = vlq();
          if (type === 0x51 && bpm == null) bpm = 60000000 / ((u8[o] << 16) | (u8[o + 1] << 8) | u8[o + 2]);
          else if (type === 0x03 && !name) name = str(o, l).trim();
          else if (type === 0x58 && beats == null) beats = u8[o];
          o += l;
          continue;
        }
        if (st === 0xF0 || st === 0xF7) { o += vlq(); continue; }
        rs = st;
        const hi = st & 0xF0, ch = st & 0x0F;
        if (hi === 0x80 || hi === 0x90) {
          const p = u8[o++], v = u8[o++], k = ch * 128 + p;
          if (hi === 0x90 && v > 0) { if (!on.has(k)) on.set(k, []); on.get(k).push([t, v]); }
          else { const s = on.get(k); if (s && s.length) { const [t0, v0] = s.shift(); notes.push({ ch, p, v: v0, t: t0, d: Math.max(1, t - t0) }); } }
        } else if (hi === 0xC0 || hi === 0xD0) o += 1;
        else o += 2;
      }
      o = end;
      tracks.push({ name, notes });
    }
    return { ppq: div, bpm: bpm || 120, beats: beats || 4, tracks };
  }

  const GM_TO_KIT = { 35: 36, 36: 36, 37: 37, 38: 38, 40: 38, 39: 39, 42: 42, 44: 42, 46: 46, 41: 45, 43: 45, 45: 45, 47: 47, 48: 50, 50: 50, 49: 49, 52: 49, 55: 49, 57: 49, 51: 46, 53: 46, 59: 46, 56: 56 };

  // Add the MIDI's notes to the song as new tracks, chopped into reusable N-bar patterns.
  function importInto(song, midi, opt) {
    opt = Object.assign({ at: 0, split: 4, setTempo: false }, opt);
    if (opt.setTempo) { song.bpm = Math.round(midi.bpm); if (midi.beats >= 2 && midi.beats <= 7) song.beatsPerBar = midi.beats; }
    const scale = TPB / midi.ppq, bt = barTicks(song), L = opt.split * bt;
    let made = 0;
    midi.tracks.forEach((mt, ti) => {
      const byCh = new Map();
      for (const n of mt.notes) { if (!byCh.has(n.ch)) byCh.set(n.ch, []); byCh.get(n.ch).push(n); }
      for (const [ch, ns] of byCh) {
        const drums = ch === 9;
        const avg = ns.reduce((a, n) => a + n.p, 0) / ns.length;
        const poly = ns.length / new Set(ns.map(n => n.t)).size;
        const preset = drums ? 'Drum Kit' : avg < 50 ? 'Triangle Bass' : poly > 1.6 ? 'Harmony 12.5%' : 'NES Lead 25%';
        const name = (mt.name || (drums ? 'Drums' : 'MIDI ' + (ti + 1))) + (byCh.size > 1 ? ' ch' + (ch + 1) : '');
        const tr = addTrack(song, name.slice(0, 28), instFromPreset(preset));
        const notes = ns.map(n => ({ t: Math.round(n.t * scale), d: Math.max(1, Math.round(n.d * scale)), p: drums ? (GM_TO_KIT[n.p] || 38) : n.p, v: n.v }));
        let end = 0;
        for (const n of notes) end = Math.max(end, n.t + 1);
        const chunks = Math.ceil(end / L), seen = new Map();
        for (let k = 0; k < chunks; k++) {
          const part = notes.filter(n => n.t >= k * L && n.t < (k + 1) * L).map(n => ({ t: n.t - k * L, d: Math.min(n.d, (k + 1) * L - n.t), p: n.p, v: n.v }));
          if (!part.length) continue;
          const sig = JSON.stringify(part);
          let pat = seen.get(sig);
          if (!pat) { pat = addPattern(song, tr.id, tr.name + ' ' + (seen.size + 1), opt.split, part); seen.set(sig, pat); }
          addClip(song, tr.id, pat.id, opt.at + k * opt.split);
        }
        made++;
      }
    });
    return made;
  }

  function vlqBytes(v) {
    const b = [v & 0x7f];
    while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80);
    return b;
  }
  const GM_PROG = { pulse: 80, saw: 81, triangle: 38, sine: 79, wave: 80, noise: 122 };

  function write(song) {
    const flat = flattenSong(song, true), chunks = [];
    const trackChunk = events => {
      events.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
      const bytes = [];
      let last = 0;
      for (const [t, data] of events) { bytes.push(...vlqBytes(t - last), ...data); last = t; }
      bytes.push(0, 0xFF, 0x2F, 0);
      return bytes;
    };
    const tempo = Math.round(60000000 / song.bpm);
    chunks.push(trackChunk([
      [0, [0xFF, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255], 0],
      [0, [0xFF, 0x58, 4, song.beatsPerBar, 2, 24, 8], 0],
    ]));
    let chan = 0;
    for (const tr of song.tracks) {
      const notes = flat.get(tr.id) || [];
      const drum = tr.inst.type === 'drums';
      let ch;
      if (drum) ch = 9;
      else { if (chan === 9) chan++; ch = chan % 16; chan++; }
      const nameBytes = Array.from(new TextEncoder().encode(tr.name));
      const ev = [[0, [0xFF, 0x03, ...vlqBytes(nameBytes.length), ...nameBytes], -1]];
      if (!drum) ev.push([0, [0xC0 | ch, GM_PROG[tr.inst.type] || 80], -1]);
      const shift = drum ? 0 : 12 * (tr.inst.octave || 0);
      for (const n of notes) {
        const p = clamp(n.p + shift, 0, 127);
        ev.push([n.t, [0x90 | ch, p, clamp(n.v, 1, 127)], 1]);
        ev.push([n.t + n.d, [0x80 | ch, p, 0], 0]);
      }
      chunks.push(trackChunk(ev));
    }
    const out = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (chunks.length >> 8) & 255, chunks.length & 255, (TPB >> 8) & 255, TPB & 255];
    for (const c of chunks) out.push(0x4D, 0x54, 0x72, 0x6B, (c.length >>> 24) & 255, (c.length >> 16) & 255, (c.length >> 8) & 255, c.length & 255, ...c);
    return new Uint8Array(out);
  }

  return { parse, importInto, write };
})();
