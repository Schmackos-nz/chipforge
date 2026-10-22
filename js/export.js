'use strict';
// Offline rendering, WAV encoding (16-bit or 8-bit), stem ZIPs.

const Exporter = (() => {
  async function render(opt) {
    const s = App.song, spt = 60 / (s.bpm * TPB), sr = opt.sampleRate || 44100;
    const len = (opt.endTick - opt.startTick) * spt;
    const tail = opt.tail == null ? 2 : opt.tail;
    const frames = Math.max(1, Math.ceil((len + tail) * sr));
    const oc = new OfflineAudioContext(2, frames, sr);
    const eng = new ChipEngine(oc);
    eng.syncAll(s);
    if (opt.only) for (const tr of s.tracks) eng.syncTrack(tr, tr.id === opt.only);
    const evs = [];
    for (const [tid, notes] of flattenSong(s, true)) {
      const tr = getTrack(tid);
      for (const n of notes) if (n.t >= opt.startTick && n.t < opt.endTick) evs.push([n.t, tr, n]);
    }
    evs.sort((a, b) => a[0] - b[0]);
    for (const [t, tr, n] of evs) {
      const sw = (t % (TPB / 2)) === TPB / 4 ? s.swing * (TPB / 4) * spt * 0.6 : 0;
      eng.noteOn(tr, n.p, n.v, (t - opt.startTick) * spt + sw, n.d * spt, false);
    }
    const buf = await oc.startRendering();
    let chans = [buf.getChannelData(0), buf.getChannelData(1)];
    if (opt.seamless) {
      // Fold the tail (release + echoes) back onto the start so the file loops with no click or gap.
      const L = Math.round(len * sr);
      chans = chans.map(d => {
        const o = new Float32Array(L);
        o.set(d.subarray(0, L));
        for (let i = L; i < d.length; i++) o[(i - L) % L] += d[i];
        return o;
      });
    }
    return { chans, sr };
  }

  function wav(chans, sr, bits, normalize) {
    const n = chans[0].length, nc = chans.length;
    let gain = 1;
    if (normalize) {
      let pk = 0;
      for (const c of chans) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > pk) pk = a; }
      if (pk > 0) gain = 0.98 / pk;
    }
    const bps = bits / 8, dataLen = n * nc * bps, buf = new ArrayBuffer(44 + dataLen), dv = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * nc * bps, true); dv.setUint16(32, nc * bps, true); dv.setUint16(34, bits, true);
    ws(36, 'data'); dv.setUint32(40, dataLen, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
      const v = clamp(chans[c][i] * gain, -1, 1);
      if (bits === 16) { dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
      else { dv.setUint8(o, Math.round((v + 1) * 127.5)); o += 1; }
    }
    return new Uint8Array(buf);
  }

  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  // Minimal stored (uncompressed) ZIP.
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = new TextEncoder().encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + sz;
    }
    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  function range(which) {
    const s = App.song, bt = barTicks(s);
    if (which === 'loop' && s.loop.end > s.loop.start) return [s.loop.start * bt, s.loop.end * bt];
    return [0, Math.max(bt, songEndBar(s) * bt)];
  }

  return { render, wav, zip, range };
})();
