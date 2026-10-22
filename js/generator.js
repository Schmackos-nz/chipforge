'use strict';
// Composition engine: analyses what's already written (key, chords, track roles, melodic habits)
// and grows new material from it — extending songs, filling gaps, varying patterns and
// generating fresh songs from style templates.

const Gen = (() => {
  const S16 = TPB / 4;
  const DEFAULT_IV = { 0: 2, 1: 4, '-1': 4, 2: 3, '-2': 3, 3: 1.4, '-3': 1.4, 4: 1, '-4': 1, 5: 0.5, '-5': 0.5, 7: 0.3, '-7': 0.3 };

  function defaultRhythms(bt) {
    const R = [
      [[0, 4], [4, 4], [8, 4], [12, 4]],
      [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
      [[0, 6], [6, 2], [8, 8]],
      [[0, 4], [4, 2], [6, 2], [8, 4], [12, 4]],
      [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]],
      [[0, 12], [12, 4]],
      [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]],
      [[2, 2], [4, 4], [8, 2], [10, 6]],
      [[0, 4], [6, 2], [8, 4], [12, 2], [14, 2]],
    ];
    return R.map(r => r.map(([a, b]) => [a * S16, b * S16]).filter(([a]) => a < bt).map(([a, b]) => [a, Math.min(b, bt - a)])).filter(r => r.length);
  }

  // Common-practice chord movement, as offsets from the tonic. Learned transitions from the
  // user's song are blended on top so new progressions sound like *their* song.
  const PRIOR_MAJ = {
    '0:': { '5:': 3, '7:': 3, '9:m': 3, '2:m': 1.5, '4:m': 0.6, '10:': 0.4 },
    '2:m': { '7:': 4, '5:': 1.2, '9:m': 0.6 },
    '4:m': { '9:m': 3, '5:': 2 },
    '5:': { '7:': 3, '0:': 3, '2:m': 1, '9:m': 1, '4:m': 0.5 },
    '7:': { '0:': 4, '9:m': 2, '5:': 1 },
    '9:m': { '5:': 3, '2:m': 2, '7:': 2, '4:m': 1 },
    '10:': { '0:': 3, '5:': 1 },
    '11:dim': { '0:': 3 },
  };
  const PRIOR_MIN = {
    '0:m': { '8:': 3, '5:m': 3, '10:': 3, '3:': 1.5, '7:m': 1, '7:': 1 },
    '3:': { '8:': 2, '10:': 2, '5:m': 2 },
    '5:m': { '7:': 2, '0:m': 2, '10:': 2, '7:m': 1 },
    '7:m': { '0:m': 3, '8:': 2 },
    '7:': { '0:m': 4, '8:': 1.5 },
    '8:': { '10:': 3, '3:': 2, '5:m': 2, '7:': 1 },
    '10:': { '0:m': 3, '3:': 3, '8:': 1 },
    '2:dim': { '7:': 3 },
  };
  function family(q) {
    if (['m', 'm7', 'm6', 'm9', 'madd9'].includes(q)) return 'm';
    if (['dim', 'dim7', 'm7b5'].includes(q)) return 'dim';
    if (q === 'aug') return 'aug';
    return '';
  }
  const tokOf = (c, key) => pc(c.root - key.root) + ':' + c.q;
  const tokFam = tk => { const i = tk.indexOf(':'); return tk.slice(0, i) + ':' + family(tk.slice(i + 1)); };
  const tokToChord = (tk, key) => { const i = tk.indexOf(':'); return makeChord(key.root + +tk.slice(0, i), tk.slice(i + 1)); };
  const tonicTok = key => (isMinorScale(key.scale) ? '0:m' : '0:');
  const domTok = () => '7:';

  function fitRange(p, r) {
    const lo = r[0] - 2, hi = Math.max(r[1] + 2, lo + 12);
    let k = 0;
    while (p > hi && k++ < 10) p -= 12;
    while (p < lo && k++ < 20) p += 12;
    return p;
  }
  function nearestPcPitch(pcv, target) {
    let best = target, bd = 99;
    for (let d = -6; d <= 6; d++) if (pc(target + d) === pc(pcv) && Math.abs(d) < bd) { bd = Math.abs(d); best = target + d; }
    return best;
  }
  function isDrumTrack(tr) { return tr.inst.type === 'drums' || tr.inst.type === 'noise'; }

  // ---------------------------------------------------------------- analysis
  function analyze(song, keyOverride) {
    const bt = barTicks(song), half = bt / 2;
    const flat = flattenSong(song, false);
    const nBars = songEndBar(song);
    const hist = new Array(12).fill(0);
    const tracks = [];
    for (const tr of song.tracks) {
      const notes = flat.get(tr.id) || [];
      const t = { id: tr.id, tr, notes, isDrum: isDrumTrack(tr), byBar: [], pool: [] };
      for (let b = 0; b < nBars; b++) t.byBar.push([]);
      for (const n of notes) {
        const b = Math.floor(n.t / bt);
        if (b < nBars) t.byBar[b].push({ t: n.t - b * bt, d: n.d, p: n.p, v: n.v });
        if (!t.isDrum) hist[pc(n.p)] += n.d * (n.v / 127);
      }
      t.byBar.forEach((a, i) => { if (a.length) t.pool.push(i); });
      if (notes.length) {
        let lo = 127, hi = 0, sum = 0;
        for (const n of notes) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); sum += n.p; }
        t.range = [lo, hi]; t.avg = sum / notes.length;
        t.poly = notes.length / new Set(notes.map(n => n.t)).size;
      } else { t.range = [60, 84]; t.avg = 72; t.poly = 1; }
      tracks.push(t);
    }

    let key;
    const total = hist.reduce((a, b) => a + b, 0);
    if (keyOverride) key = { root: keyOverride.root, scale: keyOverride.scale };
    else if (total > 0) {
      const k = detectKey(hist);
      key = { root: k.root, scale: k.scale };
      // Respect the song's own key setting when it is the same note set (e.g. user picked Dorian).
      const a = scalePcs(song.key, song.scale).sort().join(), b = scalePcs(k.root, k.scale).sort().join();
      if (a === b) key = { root: song.key, scale: song.scale };
    } else key = { root: song.key, scale: song.scale };
    key.iv = scaleIv(key.scale);

    for (const t of tracks) {
      if (t.isDrum) t.role = 'drums';
      else if (!t.notes.length) t.role = 'empty';
      else if (t.poly >= 1.7) t.role = 'chords';
      else if (t.avg < 53) t.role = 'bass';
      else t.role = 'melody';
    }
    for (const t of tracks) if (t.role === 'melody' && t.notes.length / Math.max(1, t.pool.length) >= 10) t.role = 'arp';
    const mel = tracks.filter(t => t.role === 'melody').sort((a, b) => (b.avg + b.notes.length * 0.02) - (a.avg + a.notes.length * 0.02));
    if (mel[0]) mel[0].role = 'lead';

    // Chords per half bar from every pitched track (bass weighted up, lead weighted down).
    const chords = new Array(nBars * 2).fill(null);
    const harm = tracks.filter(t => !t.isDrum && t.notes.length);
    for (let hx = 0; hx < nBars * 2; hx++) {
      const s = hx * half, e = s + half;
      const w = new Array(12).fill(0);
      let low = 999, lowPc = null;
      for (const t of harm) {
        const wt = t.role === 'bass' ? 1.5 : t.role === 'lead' ? 0.55 : 1;
        for (const n of t.notes) {
          if (n.t >= e) break;
          const ov = Math.min(e, n.t + n.d) - Math.max(s, n.t);
          if (ov <= 0) continue;
          w[pc(n.p)] += ov * wt * (n.v / 127);
          if (n.p < low) { low = n.p; lowPc = pc(n.p); }
        }
      }
      chords[hx] = detectChord(w, lowPc, key.root, key.scale);
    }
    for (let i = 1; i < chords.length; i++) if (!chords[i]) chords[i] = chords[i - 1];
    for (let i = chords.length - 2; i >= 0; i--) if (!chords[i]) chords[i] = chords[i + 1];
    const tonic = tokToChord(tonicTok(key), key);
    for (let i = 0; i < chords.length; i++) if (!chords[i]) chords[i] = tonic;

    // Melodic habits: scale-step interval distribution and bar rhythms of the melody tracks.
    const stats = { iv: {}, rhythms: [], count: 0 };
    for (const t of tracks.filter(x => x.role === 'lead' || x.role === 'melody')) {
      const byOn = new Map();
      for (const n of t.notes) { const o = byOn.get(n.t); if (!o || n.p > o.p) byOn.set(n.t, n); }
      const line = [...byOn.values()].sort((a, b) => a.t - b.t);
      for (let i = 1; i < line.length; i++) {
        const st = clamp(toScaleIdx(line[i].p, key.root, key.iv).idx - toScaleIdx(line[i - 1].p, key.root, key.iv).idx, -7, 7);
        stats.iv[st] = (stats.iv[st] || 0) + 1;
        stats.count++;
      }
      for (const bar of t.byBar) if (bar.length) {
        const r = [...new Map(bar.map(n => [n.t, [n.t, Math.max(1, Math.min(n.d, bt - n.t))]])).values()].sort((a, b) => a[0] - b[0]);
        stats.rhythms.push(r);
      }
    }
    if (stats.count < 12) for (const k in DEFAULT_IV) stats.iv[k] = (stats.iv[k] || 0) + DEFAULT_IV[k] * 2;
    if (!stats.rhythms.length) stats.rhythms = defaultRhythms(bt);

    let changes = 0, halfChanges = 0;
    for (let i = 1; i < chords.length; i++) if (!chordsEqual(chords[i], chords[i - 1])) { changes++; if (i % 2) halfChanges++; }
    return { song, bt, half, nBars, key, tracks, chords, stats, halfRate: changes ? halfChanges / changes : 0 };
  }

  function sectionsOf(an) {
    const L = an.nBars;
    const sl = L >= 8 && L % 8 === 0 ? 8 : Math.min(4, Math.max(1, L));
    const secs = [];
    for (let b = 0; b < L; b += sl) {
      const len = Math.min(sl, L - b);
      let full = 0;
      for (const t of an.tracks) { for (let i = b; i < b + len; i++) if (t.byBar[i] && t.byBar[i].length) { full++; break; } }
      secs.push({ start: b, len, full, letter: String.fromCharCode(65 + secs.length % 26) });
    }
    return { sl, secs };
  }

  // ---------------------------------------------------------------- harmony
  function genProgression(an, nBars, rng, opt) {
    opt = opt || {};
    const key = an.key, minor = isMinorScale(key.scale), prior = minor ? PRIOR_MIN : PRIOR_MAJ, tonic = tonicTok(key);
    const learned = {};
    let prev = null;
    for (const c of an.chords || []) {
      if (!c) continue;
      const tk = tokOf(c, key);
      if (prev && tk !== prev) { learned[prev] = learned[prev] || {}; learned[prev][tk] = (learned[prev][tk] || 0) + 1; }
      prev = tk;
    }
    const novelty = opt.novelty == null ? 1.5 : opt.novelty;
    const next = cur => {
      const cand = {};
      const L = learned[cur];
      if (L) { const tot = Object.values(L).reduce((a, b) => a + b, 0); for (const k in L) cand[k] = (cand[k] || 0) + L[k] / tot * 6; }
      const P = prior[cur] || prior[tokFam(cur)] || prior[tonic];
      const tot = Object.values(P).reduce((a, b) => a + b, 0);
      for (const k in P) cand[k] = (cand[k] || 0) + P[k] / tot * novelty;
      delete cand[cur];
      const pairs = Object.entries(cand);
      return pairs.length ? rng.weighted(pairs) : tonic;
    };
    const out = [];
    let cur = opt.start || (rng.chance(0.55) ? tonic : next(tonic));
    const total = nBars * 2;
    let hx = 0;
    while (hx < total) {
      const lenH = hx % 2 === 1 || rng.chance(an.halfRate * 0.8) ? 1 : 2;
      for (let k = 0; k < lenH && hx < total; k++) out[hx++] = cur;
      cur = next(cur);
    }
    if (opt.cadence === 'full' && total >= 2) {
      out[total - 1] = out[total - 2] = tonic;
      if (total >= 4 && rng.chance(0.75)) out[total - 3] = domTok();
    } else if (opt.cadence === 'half' && total >= 2) {
      out[total - 1] = out[total - 2] = domTok();
    }
    return out.map(tk => tokToChord(tk, key));
  }
  function chordAtFactory(chs, bt) { return rel => chs[clamp(Math.floor(rel / (bt / 2)), 0, chs.length - 1)]; }
  function timelineFromHalves(chs, bt) {
    const tl = [];
    for (let i = 0; i < chs.length; i++) {
      const s = i * bt / 2, e = s + bt / 2;
      const last = tl[tl.length - 1];
      if (last && chordsEqual(last.c, chs[i])) last.e = e; else tl.push({ c: chs[i], s, e });
    }
    return tl;
  }

  // ---------------------------------------------------------------- melody
  function genMelody(an, len, chAt, rng, opt) {
    opt = opt || {};
    const key = an.key, iv = key.iv, bt = an.bt, range = opt.range || [60, 84];
    const center = (range[0] + range[1]) / 2;
    const ivPairs = Object.entries(an.stats.iv).map(([k, w]) => [+k, w]);
    const rhythms = an.stats.rhythms;
    const makeMotif = () => {
      const r = rng.pick(rhythms);
      let rel = rng.pick([0, 2, 4, 4, 7]);
      const rels = [];
      for (let i = 0; i < r.length; i++) {
        if (i > 0) rel += rng.weighted(ivPairs);
        rel = clamp(rel, -3, 9);
        rels.push(rel);
      }
      return { r, rels };
    };
    const vary = m => {
      const rels = m.rels.slice();
      if (rels.length > 1) { const k = rng.int(1, rels.length - 1); rels[k] += rng.pick([-1, 1, 2, -2]); }
      return { r: m.r, rels };
    };
    const forms = len >= 8
      ? [['A', 'B', 'A', 'C', 'A', 'B', 'A', 'D'], ['A', 'A', 'B', 'C', 'A', 'A', 'B', 'D'], ['A', 'B', 'C', 'D', 'A', 'B', 'E', 'F'], ['A', 'B', 'A', 'B', 'C', 'D', 'C', 'E']]
      : [['A', 'B', 'A', 'C'], ['A', 'A', 'B', 'C'], ['A', 'B', 'A', 'B'], ['A', 'B', 'C', 'B']];
    const form = rng.pick(forms);
    const motifs = {};
    const out = [];
    for (let i = 0; i < len; i++) {
      const letter = form[i % form.length];
      let m = motifs[letter];
      if (!m) m = motifs[letter] = makeMotif();
      else if (rng.chance(0.4)) m = vary(m);
      const lastBar = opt.cadence && i === len - 1;
      const ch = chAt(i * bt);
      const rootIdx = toScaleIdx(nearestPcPitch(ch.root, Math.round(center - 4)), key.root, iv).idx;
      if (lastBar) {
        const prevP = out.length ? out[out.length - 1].p : Math.round(center);
        const target = opt.cadence === 'full' ? nearestPcPitch(key.root, prevP) : nearestChordTone(prevP, ch);
        if (rng.chance(0.5)) {
          out.push({ t: i * bt, d: S16 * 2, p: fitRange(shiftInScale(target, rng.pick([1, 2, -1]), key.root, iv), range), v: 96 });
          out.push({ t: i * bt + S16 * 2, d: bt - S16 * 2, p: fitRange(target, range), v: 104 });
        } else out.push({ t: i * bt, d: bt, p: fitRange(target, range), v: 104 });
        continue;
      }
      for (let j = 0; j < m.r.length; j++) {
        const [t, d] = m.r[j];
        const abs = i * bt + t;
        let p = fromScaleIdx(rootIdx + m.rels[j], 0, key.root, iv);
        const chh = chAt(abs);
        if ((t % (TPB * 2) === 0 || d >= TPB) && chh && !chordHas(chh, p)) p = nearestChordTone(p, chh);
        out.push({ t: abs, d, p: fitRange(p, range), v: t % TPB === 0 ? rng.int(100, 116) : rng.int(84, 100) });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- variation
  function mutateMelody(notes, an, chAt, s, rng, range) {
    const key = an.key, out = [];
    const sorted = notes.slice().sort((a, b) => a.t - b.t);
    for (const n0 of sorted) {
      const n = Object.assign({}, n0);
      if (rng.chance(s * 0.3)) n.p = shiftInScale(n.p, rng.pick([-2, -1, -1, 1, 1, 2]), key.root, key.iv);
      const strong = n.t % (TPB * 2) === 0 || (n.t % TPB === 0 && n.d >= TPB);
      if (strong) { const ch = chAt(n.t); if (ch && !chordHas(ch, n.p) && rng.chance(0.75)) n.p = nearestChordTone(n.p, ch); }
      n.p = fitRange(n.p, range);
      if (n.d >= TPB / 2 && rng.chance(s * 0.18)) {
        const a = Math.max(S16, Math.round(n.d / 2 / S16) * S16);
        if (a < n.d) {
          out.push(Object.assign({}, n, { d: a }));
          out.push(Object.assign({}, n, { t: n.t + a, d: n.d - a, p: fitRange(shiftInScale(n.p, rng.pick([-1, 1, 2]), key.root, key.iv), range) }));
          continue;
        }
      }
      if (sorted.length > 4 && rng.chance(s * 0.06)) continue;
      out.push(n);
    }
    return out;
  }
  function mutateBass(notes, an, s, rng, range, len) {
    const key = an.key, bt = an.bt;
    const out = notes.map(n => Object.assign({}, n)).sort((a, b) => a.t - b.t);
    for (const n of out) if (n.t % bt !== 0 && n.d <= TPB / 2 && rng.chance(s * 0.15)) n.p = fitRange(n.p + rng.pick([12, -12]), [range[0], range[1] + 12]);
    for (let i = 1; i < len; i++) {
      const nextFirst = out.find(n => n.t === i * bt);
      if (!nextFirst || !rng.chance(s * 0.5)) continue;
      const lastIn = out.filter(n => n.t < i * bt && n.t >= i * bt - TPB / 2).pop();
      if (lastIn && lastIn.p !== nextFirst.p) lastIn.p = shiftInScale(nextFirst.p, rng.pick([-1, 1]), key.root, key.iv);
    }
    return out;
  }
  function mutateDrums(notes, s, rng, bt, totalTicks) {
    const out = [];
    const hasHat = notes.some(n => n.p === 42);
    for (const n of notes) {
      if (n.p === 42 && n.t % TPB !== 0 && rng.chance(s * 0.15)) continue;
      out.push(Object.assign({}, n));
    }
    if (hasHat) {
      for (let t = S16; t < totalTicks; t += S16 * 2) {
        if (rng.chance(s * 0.06) && !out.some(n => n.t === t && n.p === 42)) out.push({ t, d: S16, p: 42, v: 55 });
      }
    }
    const bars = Math.round(totalTicks / bt);
    for (let b = 0; b < bars; b++) {
      if (!rng.chance(s * 0.25)) continue;
      const t = b * bt + rng.pick([3, 5, 7]) * (TPB / 2) % bt;
      if (t < totalTicks && !out.some(n => n.t === t && n.p === 36)) out.push({ t, d: S16, p: 36, v: 96 });
    }
    return out;
  }
  function drumFill(notes, totalTicks, rng, kitType) {
    const beats = rng.chance(0.35) ? 2 : 1;
    const fs = totalTicks - beats * TPB;
    if (fs < 0) return notes;
    const out = notes.filter(n => n.t < fs || (n.p === 36 && n.t === fs));
    const style = rng.pick(['roll', 'toms', 'mix', 'trip']);
    if (kitType === 'noise') {
      for (let t = fs; t < totalTicks; t += S16) out.push({ t, d: S16, p: 72 + Math.round((t - fs) / S16), v: 70 + Math.round(40 * (t - fs) / (totalTicks - fs)) });
      return out;
    }
    const step = style === 'trip' ? TPB / 6 : S16;
    const toms = [50, 50, 47, 47, 45, 45, 45, 45];
    let k = 0;
    for (let t = fs; t < totalTicks; t += step, k++) {
      const v = 70 + Math.round(45 * (t - fs) / (totalTicks - fs));
      let p = 38;
      if (style === 'toms') p = toms[Math.min(toms.length - 1, Math.floor(k * 8 / Math.max(1, Math.round((totalTicks - fs) / step))))];
      else if (style === 'mix') p = k % 4 < 2 ? 38 : (k % 4 === 2 ? 47 : 45);
      if (style === 'toms' && k % 2 === 1) continue;
      out.push({ t, d: step, p, v });
    }
    return out;
  }
  function mutate(notes, t, an, chAt, s, rng, len) {
    if (t.isDrum) return mutateDrums(notes, s, rng, an.bt, len * an.bt);
    if (t.role === 'chords' || t.role === 'arp') return notes.map(n => Object.assign({}, n));
    if (t.role === 'bass') return mutateBass(notes, an, s, rng, t.range, len);
    return mutateMelody(notes, an, chAt, s, rng, t.range);
  }

  function applyEnding(notes, t, an, len, tonic) {
    const bt = an.bt, L = (len - 1) * bt;
    const out = [];
    for (const n of notes) {
      if (n.t >= L) continue;
      out.push(n.t + n.d > L ? Object.assign({}, n, { d: L - n.t }) : n);
    }
    if (t.isDrum) {
      if (t.tr.inst.type === 'drums') out.push({ t: L, d: S16, p: 36, v: 112 }, { t: L, d: TPB, p: 49, v: 110 });
      else out.push({ t: L, d: TPB, p: 84, v: 100 });
    } else if (t.role === 'bass') {
      out.push({ t: L, d: bt, p: nearestPcPitch(tonic.root, Math.round(t.range[0] + 5)), v: 104 });
    } else if (t.role === 'chords' || t.role === 'arp') {
      for (const p of voiceChord(tonic, Math.round(t.avg))) out.push({ t: L, d: bt, p, v: 92 });
    } else {
      const last = out.length ? out[out.length - 1].p : Math.round(t.avg);
      out.push({ t: L, d: bt, p: fitRange(nearestPcPitch(tonic.root, last), t.range), v: 104 });
    }
    return out;
  }

  // ---------------------------------------------------------------- sections
  function buildSection(an, plan, rng, opt) {
    const { type, src, len } = plan, bt = an.bt, half = an.half, key = an.key;
    const srcBar = i => src.start + (i % src.len);
    const srcCh = [];
    for (let i = 0; i < len; i++) srcCh.push(an.chords[srcBar(i) * 2], an.chords[srcBar(i) * 2 + 1]);
    let tgtCh = type === 'new'
      ? genProgression(an, len, rng, { cadence: plan.cadence || 'none', novelty: 0.8 + opt.creativity * 2.2 })
      : srcCh.slice();
    const tonic = tokToChord(tonicTok(key), key);
    if (plan.ending) { tgtCh[len * 2 - 1] = tgtCh[len * 2 - 2] = tonic; }
    const srcAt = chordAtFactory(srcCh, bt), tgtAt = chordAtFactory(tgtCh, bt);
    const strength = type === 'variation' ? 0.2 + opt.creativity * 0.55 : type === 'new' ? 0.3 + opt.creativity * 0.5 : type === 'breakdown' ? 0.3 : 0.15;
    const out = new Map();
    for (const t of an.tracks) {
      if (t.role === 'empty' || (plan.drop && plan.drop.has(t.id))) continue;
      let notes = [];
      for (let i = 0; i < len; i++) {
        let sb = srcBar(i), bar = t.byBar[sb] || [], fromPool = null;
        if (!bar.length && type === 'new' && t.pool.length && rng.chance(0.3)) {
          sb = rng.pick(t.pool); bar = t.byBar[sb];
          fromPool = [an.chords[sb * 2], an.chords[sb * 2 + 1]];
        }
        for (const n of bar) {
          if (n.t >= bt) continue;
          const m = { t: n.t + i * bt, d: Math.max(1, Math.min(n.d, len * bt - (n.t + i * bt))), p: n.p, v: n.v };
          if (!t.isDrum) {
            const sc = fromPool ? fromPool[n.t >= half ? 1 : 0] : srcAt(m.t);
            m.p = mapPitchToChord(n.p, sc, tgtAt(m.t), key.root, key.iv);
          }
          notes.push(m);
        }
      }
      if (t.role === 'lead' && type === 'new' && rng.chance(0.35 + opt.creativity * 0.5)) {
        notes = genMelody(an, len, tgtAt, rng, { range: t.range });
      }
      notes = mutate(notes, t, an, tgtAt, strength, rng, len);
      if (t.isDrum && type !== 'repeat' && !plan.ending && rng.chance(0.6)) notes = drumFill(notes, len * bt, rng, t.tr.inst.type);
      if (t.isDrum && plan.crash && t.tr.inst.type === 'drums' && !notes.some(n => n.t === 0 && n.p === 49)) notes.push({ t: 0, d: TPB, p: 49, v: 100 });
      if (type === 'breakdown') for (const n of notes) n.v = Math.max(20, Math.round(n.v * 0.78));
      if (plan.ending) notes = applyEnding(notes, t, an, len, tonic);
      out.set(t.id, notes.filter(n => n.t >= 0 && n.t < len * bt));
    }
    return { notes: out, chords: tgtCh };
  }

  function pickType(rng, last, c, idx) {
    const w = [
      ['repeat', 0.25 + 1.1 * (1 - c)],
      ['variation', 1.5],
      ['new', 0.35 + c * 1.3],
      ['breakdown', idx >= 1 ? 0.45 : 0],
    ];
    for (const p of w) {
      if (p[0] === last) p[1] *= p[0] === 'breakdown' ? 0 : 0.45;
      if (last === 'breakdown' && (p[0] === 'repeat' || p[0] === 'variation')) p[1] *= 1.8;
    }
    if (idx === 0) w[1][1] *= 1.6;
    return rng.weighted(w);
  }
  function pickSrc(rng, secs, type) {
    if (type === 'breakdown') return rng.pick(secs);
    return rng.weighted(secs.map(s => [s, 0.3 + s.full * s.full]));
  }

  // Copy an original section verbatim — reusing the user's own clips when they sit cleanly inside it.
  function copySection(song, an, src, start, len, cache) {
    const bt = an.bt, pm = patternMap(song), end = src.start + len;
    const inside = [], crossing = [];
    for (const c of song.clips) {
      const p = pm.get(c.pattern);
      if (!p) continue;
      const ce = c.bar + p.bars;
      if (c.bar >= src.start && ce <= end) inside.push(c);
      else if (c.bar < end && ce > src.start) crossing.push(c);
    }
    if (!crossing.length) {
      for (const c of inside) addClip(song, c.track, c.pattern, c.bar - src.start + start);
      return;
    }
    for (const t of an.tracks) {
      const ck = t.id + ':' + src.start + ':' + len;
      let pat = cache.get(ck);
      if (pat === undefined) {
        const notes = [];
        for (let i = 0; i < len; i++) for (const n of (t.byBar[src.start + i] || [])) notes.push({ t: n.t + i * bt, d: Math.max(1, Math.min(n.d, len * bt - n.t - i * bt)), p: n.p, v: n.v });
        pat = notes.length ? addPattern(song, t.id, src.letter + ' ' + t.tr.name, len, notes) : null;
        cache.set(ck, pat);
      }
      if (pat) addClip(song, t.id, pat.id, start);
    }
  }

  function applyPlans(song, an, plans, rng, opt) {
    const cache = new Map();
    let letterN = 0;
    const usedLetters = new Set(sectionsOf(an).secs.map(s => s.letter));
    const freshLetter = () => { let L; do { L = String.fromCharCode(65 + (letterN++ % 26)); } while (usedLetters.has(L) && letterN < 26); usedLetters.add(L); return L; };
    let prevType = null;
    for (const plan of plans) {
      let label;
      if (plan.type === 'repeat') {
        copySection(song, an, plan.src, plan.start, plan.len, cache);
        song.markers.push({ bar: plan.start, name: plan.src.letter });
        prevType = plan.type;
        continue;
      }
      if (plan.type === 'breakdown') {
        const drop = new Set();
        const drums = an.tracks.filter(t => t.isDrum), others = an.tracks.filter(t => !t.isDrum && t.role !== 'empty');
        if (drums.length && rng.chance(0.6)) drums.forEach(t => drop.add(t.id));
        else { others.filter(t => t.role === 'lead' || t.role === 'chords').forEach(t => drop.add(t.id)); }
        if (rng.chance(0.3)) others.filter(t => t.role === 'bass').forEach(t => drop.add(t.id));
        if (drop.size >= an.tracks.filter(t => t.role !== 'empty').length) drop.clear();
        plan.drop = drop;
        label = 'Breakdown';
      } else if (plan.type === 'variation') label = plan.src.letter + "'";
      else if (plan.type === 'new') label = freshLetter() + ' (new)';
      else if (plan.type === 'outro') { plan.type = 'variation'; plan.ending = true; label = 'Outro'; }
      plan.crash = prevType === 'breakdown' || (plan.type === 'new' && rng.chance(0.6));
      const res = buildSection(an, plan, rng, opt);
      for (const [tid, notes] of res.notes) {
        if (!notes.length) continue;
        const tr = getTrack(tid, song);
        const pat = addPattern(song, tid, label + ' ' + tr.name, plan.len, notes);
        addClip(song, tid, pat.id, plan.start);
      }
      song.markers.push({ bar: plan.start, name: label });
      prevType = plan.type;
    }
  }

  function addOriginalMarkers(song, an) {
    if (song.markers.some(m => m.bar < an.nBars)) return;
    for (const s of sectionsOf(an).secs) song.markers.push({ bar: s.start, name: s.letter });
  }

  // Extend the song until it is `targetSec` long, in sections built from the existing material.
  function extend(song, targetSec, opt) {
    opt = Object.assign({ creativity: 0.5, ending: true, seed: 1 }, opt);
    const an = analyze(song, opt.key);
    if (!an.nBars) throw new Error('The song is empty — write a few bars (or generate a new song) first.');
    const barSec = song.beatsPerBar * 60 / song.bpm;
    const targetBars = Math.ceil(targetSec / barSec - 1e-6);
    if (targetBars <= an.nBars) throw new Error('The song is already ' + fmtTime(an.nBars * barSec) + ' long.');
    const rng = makeRng(opt.seed);
    const { secs } = sectionsOf(an);
    // Phrases of at least 8 bars for long extensions; short sources simply wrap inside a section.
    const sl = Math.max(sectionsOf(an).sl, targetBars - an.nBars >= 32 ? 8 : 4);
    const plans = [];
    let bar = an.nBars, last = null, idx = 0;
    while (bar < targetBars) {
      const remain = targetBars - bar;
      let len = Math.min(sl, remain);
      if (remain > sl && remain - sl < Math.min(4, sl) && remain <= sl * 2) len = remain; // absorb a tiny tail into this section
      const isLast = bar + len >= targetBars;
      let type;
      if (isLast && opt.ending) type = 'outro';
      else type = pickType(rng, last, opt.creativity, idx);
      const src = type === 'outro' ? secs[0] : pickSrc(rng, secs, type);
      plans.push({ type, src, len, start: bar, cadence: type === 'new' ? (rng.chance(0.5) ? 'half' : 'full') : null });
      bar += len; last = type; idx++;
    }
    addOriginalMarkers(song, an);
    applyPlans(song, an, plans, rng, opt);
    return { added: targetBars - an.nBars, sections: plans.length, key: an.key };
  }

  // Fill bars where every track is silent, between the first and last written bars.
  function fillGaps(song, opt) {
    opt = Object.assign({ creativity: 0.5, seed: 1 }, opt);
    const an = analyze(song, opt.key);
    if (!an.nBars) throw new Error('The song is empty.');
    const rng = makeRng(opt.seed);
    const { sl, secs } = sectionsOf(an);
    const empty = b => an.tracks.every(t => !t.byBar[b] || !t.byBar[b].length);
    const plans = [];
    let b = 0;
    while (b < an.nBars) {
      if (!empty(b)) { b++; continue; }
      let e = b;
      while (e < an.nBars && empty(e)) e++;
      let s = b;
      while (s < e) {
        const len = Math.min(sl, e - s);
        const full = secs.filter(x => x.full > 0);
        if (!full.length) break;
        const before = full.filter(x => x.start + x.len <= s);
        const src = before.length && rng.chance(0.6) ? before[before.length - 1] : pickSrc(rng, full, 'variation');
        plans.push({ type: rng.chance(0.3 + opt.creativity * 0.4) ? 'new' : 'variation', src, len, start: s });
        s += len;
      }
      b = e;
    }
    if (!plans.length) throw new Error('No silent gaps found between the first and last bars.');
    applyPlans(song, an, plans, rng, opt);
    return { filled: plans.reduce((a, p) => a + p.len, 0) };
  }

  // Chords sounding under a pattern, from the rest of the song (or a fresh progression).
  function contextFor(song, pat, rng) {
    const an = analyze(song);
    const clip = song.clips.find(c => c.pattern === pat.id);
    const halves = pat.bars * 2;
    let chs;
    const otherNotes = an.tracks.some(t => t.id !== pat.track && !t.isDrum && t.notes.length);
    if (clip && otherNotes && an.chords.length) {
      chs = [];
      for (let i = 0; i < halves; i++) chs.push(an.chords[Math.min(an.chords.length - 1, clip.bar * 2 + i)]);
    } else chs = genProgression(an, pat.bars, rng, { cadence: 'none' });
    return { an, chs, chAt: chordAtFactory(chs, an.bt) };
  }

  function varyPattern(song, patId, strength, seed) {
    const pat = getPattern(patId, song), tr = getTrack(pat.track, song), rng = makeRng(seed);
    const { an, chAt } = contextFor(song, pat, rng);
    const bt = an.bt, notes = pat.notes;
    if (!notes.length) throw new Error('Pattern is empty — nothing to vary.');
    let lo = 127, hi = 0;
    for (const n of notes) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
    const poly = notes.length / new Set(notes.map(n => n.t)).size;
    const avg = notes.reduce((a, n) => a + n.p, 0) / notes.length;
    const t = { isDrum: isDrumTrack(tr), tr, range: [lo, hi], avg, role: isDrumTrack(tr) ? 'drums' : poly >= 1.7 ? 'chords' : avg < 53 ? 'bass' : 'lead' };
    let out;
    if (t.role === 'chords') {
      // Re-voice: move some chord onsets up/down an inversion.
      const byOn = new Map();
      for (const n of notes) { if (!byOn.has(n.t)) byOn.set(n.t, []); byOn.get(n.t).push(Object.assign({}, n)); }
      out = [];
      for (const grp of byOn.values()) {
        grp.sort((a, b) => a.p - b.p);
        if (grp.length > 1 && rng.chance(strength * 0.6)) { if (rng.chance(0.5)) grp[0].p += 12; else grp[grp.length - 1].p -= 12; }
        out.push(...grp);
      }
    } else out = mutate(notes, t, an, chAt, strength, rng, pat.bars);
    if (t.isDrum && rng.chance(0.5)) out = drumFill(out, pat.bars * bt, rng, tr.inst.type);
    pat.notes = out.filter(n => n.t < pat.bars * bt);
  }

  // ---------------------------------------------------------------- part generators
  function genChordPart(tl, style, center) {
    const out = [];
    let prev = null;
    for (const seg of tl) {
      if (!seg.c) continue;
      const v = voiceChord(seg.c, center || 64, prev);
      prev = v;
      const len = seg.e - seg.s;
      const seqUp = v.concat([v[0] + 12]);
      let seq = null;
      if (style === 'arpUp') seq = seqUp;
      else if (style === 'arpDown') seq = seqUp.slice().reverse();
      else if (style === 'arpUpDown') seq = seqUp.concat(seqUp.slice(1, -1).reverse());
      else if (style === 'broken') seq = [v[0], v[2 % v.length], v[1 % v.length], v[2 % v.length]];
      if (seq) {
        const step = style === 'broken' ? TPB / 2 : S16;
        let k = 0;
        for (let t = seg.s; t < seg.e; t += step, k++) out.push({ t, d: Math.min(step, seg.e - t), p: seq[k % seq.length], v: k % 4 === 0 ? 96 : 80 });
      } else if (style === 'stabs') {
        for (let t = seg.s; t < seg.e; t += TPB / 2) for (const p of v) out.push({ t, d: S16, p, v: (t - seg.s) % TPB === 0 ? 96 : 76 });
      } else if (style === 'offbeat') {
        for (let t = seg.s + TPB / 2; t < seg.e; t += TPB) for (const p of v) out.push({ t, d: S16 * 1.5, p, v: 88 });
      } else if (style === 'pulse') {
        for (let t = seg.s; t < seg.e; t += TPB) for (const p of v) out.push({ t, d: Math.min(TPB * 0.75, seg.e - t), p, v: 86 });
      } else for (const p of v) out.push({ t: seg.s, d: len, p, v: 84 });
    }
    return out;
  }
  function genBassPart(tl, style, low) {
    const out = [];
    low = low || 33;
    for (let i = 0; i < tl.length; i++) {
      const seg = tl[i];
      if (!seg.c) continue;
      const root = bassPitch(seg.c, low), fifth = root + 7, third = root + (seg.c.iv[1] === 3 ? 3 : 4);
      const nextRoot = tl[i + 1] && tl[i + 1].c ? bassPitch(tl[i + 1].c, low) : root;
      const len = seg.e - seg.s;
      if (style === 'whole') { out.push({ t: seg.s, d: len, p: root, v: 104 }); continue; }
      const step = style === 'quarters' || style === 'rootFifth' || style === 'walk' ? TPB : TPB / 2;
      let k = 0;
      for (let t = seg.s; t < seg.e; t += step, k++) {
        let p = root;
        if (style === 'octave') p = k % 2 ? root + 12 : root;
        else if (style === 'rootFifth') p = k % 2 ? fifth : root;
        else if (style === 'walk') { const left = Math.round((seg.e - t) / step); p = left === 1 && nextRoot !== root ? nextRoot + (nextRoot > root ? -1 : 1) : [root, third, fifth, third][k % 4]; }
        out.push({ t, d: Math.min(step * (style === 'eighths' || style === 'octave' ? 0.85 : 0.95), seg.e - t), p, v: k % 2 ? 92 : 108 });
      }
    }
    return out.map(n => Object.assign(n, { d: Math.max(1, Math.round(n.d)) }));
  }
  const DRUM_STYLES = {
    march: { 36: 'x.......x.......', 38: '....x.......x...', 42: 'x.x.x.x.x.x.x.x.' },
    driving: { 36: 'x.....x.x.....x.', 38: '....x.......x...', 42: 'xxxxxxxxxxxxxxxx' },
    sparse: { 36: 'x.........x.....', 38: '........x.......', 42: '....x.......x...' },
    lilt: { 36: 'x.....x...x.....', 38: '....x.......x...', 42: '..x...x...x...x.' },
    halftime: { 36: 'x.......x.x.....', 38: '........x.......', 42: 'x.x.x.x.x.x.x.x.' },
    rock: { 36: 'x.....x.x.......', 38: '....x.......x...', 42: 'x.x.x.x.x.x.x.x.', 46: '..............x.' },
  };
  function genDrumPart(style, bars, bt) {
    const tpl = DRUM_STYLES[style] || DRUM_STYLES.march, out = [];
    const steps = bt / S16;
    for (let b = 0; b < bars; b++) for (const p in tpl) {
      const s = tpl[p];
      for (let i = 0; i < steps; i++) if (s[i % 16] === 'x') {
        const pp = +p;
        out.push({ t: b * bt + i * S16, d: S16, p: pp, v: pp === 42 ? (i % 4 === 0 ? 78 : 60) : pp === 36 ? 112 : 104 });
      }
    }
    return out;
  }

  // Replace a pattern's notes with a generated part over the chords around it.
  function generatePart(song, patId, role, seed) {
    const pat = getPattern(patId, song), tr = getTrack(pat.track, song), rng = makeRng(seed);
    const { an, chs, chAt } = contextFor(song, pat, rng);
    const tl = timelineFromHalves(chs, an.bt);
    let notes;
    if (role === 'drums') notes = genDrumPart(rng.pick(Object.keys(DRUM_STYLES)), pat.bars, an.bt);
    else if (role === 'bass') notes = genBassPart(tl, rng.pick(['eighths', 'octave', 'rootFifth', 'walk', 'quarters']), 33);
    else if (role === 'chords') notes = genChordPart(tl, rng.pick(['block', 'stabs', 'pulse', 'offbeat']), 62);
    else if (role === 'arp') notes = genChordPart(tl, rng.pick(['arpUp', 'arpDown', 'arpUpDown', 'broken']), 66);
    else notes = genMelody(an, pat.bars, chAt, rng, { range: [62, 84], cadence: pat.bars >= 4 ? 'half' : null });
    if (tr.inst.type === 'noise' && role === 'drums') notes = notes.map(n => Object.assign(n, { p: n.p === 36 ? 48 : n.p === 38 ? 67 : 84 }));
    pat.notes = notes;
  }

  // ---------------------------------------------------------------- chord import
  function chordsToTracks(song, items, opt) {
    const bt = barTicks(song), unit = opt.unitBeats * TPB;
    const tl = [];
    let t = 0;
    for (const it of items) { const e = t + Math.round(it.len * unit); if (it.chord) tl.push({ c: it.chord, s: t, e }); t = e; }
    const bars = Math.max(1, Math.ceil(t / bt));
    const made = [];
    const target = (which, name, preset) => {
      if (which && which !== 'new') return getTrack(which, song);
      return addTrack(song, name, instFromPreset(preset));
    };
    if (opt.makeChords) {
      const tr = target(opt.chordTrack, 'Chords', opt.chordStyle.startsWith('arp') || opt.chordStyle === 'broken' ? 'Harmony 12.5%' : 'Soft Square Pad');
      const pat = addPattern(song, tr.id, 'Chords ' + (trackPatterns(tr.id, song).length + 1), bars, genChordPart(tl, opt.chordStyle, opt.center || 62));
      addClip(song, tr.id, pat.id, opt.startBar);
      made.push(pat);
    }
    if (opt.makeBass) {
      const tr = target(opt.bassTrack, 'Bass', 'Triangle Bass');
      const pat = addPattern(song, tr.id, 'Bass ' + (trackPatterns(tr.id, song).length + 1), bars, genBassPart(tl, opt.bassStyle, 33));
      addClip(song, tr.id, pat.id, opt.startBar);
      made.push(pat);
    }
    return { bars, patterns: made };
  }

  // Detect a chord list from MIDI notes (for "import chord progression from MIDI").
  function chordsFromNotes(notes, ppq, beatsPerChord, keyRoot, scaleName) {
    const span = ppq * beatsPerChord;
    let end = 0;
    for (const n of notes) end = Math.max(end, n.t + n.d);
    const out = [];
    for (let s = 0; s < end; s += span) {
      const w = new Array(12).fill(0);
      let low = 999, lowPc = null;
      for (const n of notes) {
        const ov = Math.min(s + span, n.t + n.d) - Math.max(s, n.t);
        if (ov <= 0) continue;
        w[pc(n.p)] += ov;
        if (n.p < low) { low = n.p; lowPc = pc(n.p); }
      }
      const c = detectChord(w, lowPc, keyRoot, scaleName);
      if (c && lowPc != null && lowPc !== c.root && chordHas(c, low)) c.bass = lowPc;
      const prev = out[out.length - 1];
      if (prev && prev.c && c && chordsEqual(prev.c, c) && prev.c.bass === c.bass) prev.n++;
      else out.push({ c, n: 1 });
    }
    return out.map(o => (o.c ? chordName(o.c) : 'N.C.') + (o.n > 1 ? ':' + o.n : '')).join(' ');
  }

  // ---------------------------------------------------------------- new songs from a style
  const STYLES = {
    overworld: { name: 'Overworld Adventure', bpm: [128, 150], scale: 'major', progs: ['I V vi IV', 'I IV V IV', 'I vi IV V', 'I IV vi V', 'vi IV I V'], drums: 'march', bass: 'octave', chords: 'arpUp', lead: 'NES Lead 25%', harm: 'Harmony 12.5%' },
    town: { name: 'Cozy Town', bpm: [92, 110], scale: 'major', progs: ['I IV I V', 'I iii IV V', 'I vi ii V', 'IV V I vi'], drums: 'lilt', bass: 'rootFifth', chords: 'broken', swing: 0.35, lead: '4-bit Flute', harm: 'Harmony 12.5%' },
    dungeon: { name: 'Dark Dungeon', bpm: [96, 116], scale: 'minor', progs: ['i VI VII i', 'i iv v i', 'i bVI bVII i', 'i iv VI V'], drums: 'sparse', bass: 'quarters', chords: 'arpUpDown', lead: 'Echo Lead', harm: 'Soft Square Pad' },
    battle: { name: 'Battle Theme', bpm: [160, 184], scale: 'minor', progs: ['i VI III VII', 'i VII VI VII', 'i iv VII III', 'i VI iv V'], drums: 'driving', bass: 'octave', chords: 'arpUp', lead: 'Square Lead 50%', harm: 'Harmony 12.5%' },
    boss: { name: 'Boss Fight', bpm: [150, 172], scale: 'harmonicMinor', progs: ['i bII i V', 'i VI iv V', 'i iv V i', 'i bVI bII V'], drums: 'driving', bass: 'eighths', chords: 'stabs', lead: 'Crushed Saw', harm: 'Harmony 12.5%' },
    space: { name: 'Space Station', bpm: [100, 124], scale: 'dorian', progs: ['i IV i IV', 'i bVII IV i', 'i ii i bVII'], drums: 'halftime', bass: 'rootFifth', chords: 'arpUp', lead: 'Glide Lead', harm: 'GB Wave Pad' },
    puzzle: { name: 'Puzzle / Menu', bpm: [112, 126], scale: 'lydian', progs: ['I II I II', 'I II iii II', 'IV V iii vi'], drums: 'lilt', bass: 'eighths', chords: 'broken', lead: 'Thin Lead 12.5%', harm: 'Harmony 12.5%' },
    victory: { name: 'Victory Fanfare', bpm: [132, 146], scale: 'major', progs: ['I IV V I', 'I bVI bVII I', 'IV V I I'], drums: 'march', bass: 'octave', chords: 'stabs', lead: 'Square Lead 50%', harm: 'Harmony 12.5%' },
    sad: { name: 'Sad Ballad', bpm: [72, 88], scale: 'minor', progs: ['i VI III VII', 'i iv i V', 'VI VII i i', 'i v VI iv'], drums: 'sparse', bass: 'whole', chords: 'arpUp', lead: '4-bit Flute', harm: 'GB Wave Pad' },
    chase: { name: 'Chase / Speed Zone', bpm: [170, 196], scale: 'minor', progs: ['i bVII bVI bVII', 'i i bVI bVII', 'i III VII VI'], drums: 'driving', bass: 'octave', chords: 'arpUp', lead: 'NES Lead 25%', harm: 'Chip Arp Minor' },
    rock: { name: 'Chip Rock', bpm: [138, 158], scale: 'mixolydian', progs: ['I bVII IV I', 'I IV bVII IV', 'I bVII vi IV'], drums: 'rock', bass: 'eighths', chords: 'stabs', lead: 'Crushed Saw', harm: 'Pulse Bass' },
  };

  function newSong(styleKey, opt) {
    opt = opt || {};
    const st = STYLES[styleKey] || STYLES.overworld;
    const rng = makeRng(opt.seed || 1);
    const song = emptySong();
    song.name = st.name;
    song.bpm = rng.int(st.bpm[0], st.bpm[1]);
    song.key = opt.key != null ? opt.key : rng.pick([0, 2, 4, 5, 7, 9]);
    song.scale = st.scale;
    song.swing = st.swing || 0;
    const bt = barTicks(song);
    const lead = addTrack(song, 'Lead', instFromPreset(st.lead));
    const harm = addTrack(song, 'Harmony', instFromPreset(st.harm));
    const bass = addTrack(song, 'Bass', instFromPreset('Triangle Bass'));
    const drums = addTrack(song, 'Drums', instFromPreset('Drum Kit'));
    if (st.harm === 'Pulse Bass') { harm.inst.octave = 1; harm.inst.vol = 0.4; }
    if (st.harm === 'Chip Arp Minor') harm.inst.arp = 'off';
    harm.inst.pan = -0.2; lead.inst.pan = 0.1;

    const prog = parseProgression(rng.pick(st.progs), song.key, song.scale).items.filter(i => i.chord);
    const bars = 8;
    const halves = [];
    for (let b = 0; b < bars; b++) {
      let c = prog[b % prog.length].chord;
      if (b === bars - 1 && rng.chance(0.6)) c = makeChord(song.key + 7, '', null); // turnaround on V
      halves.push(c, c);
    }
    const tl = timelineFromHalves(halves, bt);
    const key = { root: song.key, scale: song.scale, iv: scaleIv(song.scale) };
    const an = { key, bt, half: bt / 2, stats: { iv: Object.assign({}, DEFAULT_IV), rhythms: defaultRhythms(bt) }, chords: halves, halfRate: 0 };
    const chAt = chordAtFactory(halves, bt);
    const melody = genMelody(an, bars, chAt, rng, { range: [64, 86], cadence: 'half' });

    const mk = (tr, name, notes) => { const p = addPattern(song, tr.id, name, bars, notes); addClip(song, tr.id, p.id, 0); };
    mk(lead, 'Theme', melody);
    mk(harm, 'Harmony', genChordPart(tl, st.chords, st.chords.startsWith('arp') ? 66 : 62));
    mk(bass, 'Bassline', genBassPart(tl, st.bass, 33));
    const dn = genDrumPart(st.drums, bars, bt);
    mk(drums, 'Beat', drumFill(dn, bars * bt, rng, 'drums'));
    song.markers.push({ bar: 0, name: 'A' });
    if (opt.lengthSec && opt.lengthSec > bars * song.beatsPerBar * 60 / song.bpm + 1) {
      song.markers = [];
      extend(song, opt.lengthSec, { creativity: opt.creativity == null ? 0.5 : opt.creativity, seed: (opt.seed || 1) + 99, ending: true });
    }
    return song;
  }

  return { analyze, extend, fillGaps, varyPattern, generatePart, chordsToTracks, chordsFromNotes, newSong, STYLES, genProgression, sectionsOf };
})();
