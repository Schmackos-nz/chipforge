'use strict';
// Application menu bar (File / Edit / Track / Tools / View / Help) with the project name on the right.

const Menu = {
  open: null, // { btn, panel }

  defs() {
    const ed = () => (App.view === 'piano' ? PR : App.view === 'arrange' ? ARR : null);
    const edit = m => () => { const e = ed(); if (e) e[m](); else toast('Open the Playlist or Piano roll first'); };
    const tr = () => getTrack(App.selTrack);
    const importSound = async () => { const f = await pickFile('audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm'); if (f) { await SMP.importAsTrack(f); UI.setView('arrange'); } };
    const sep = null;
    return [
      ['File', [
        ['New project', () => this.act('new')],
        ['Open project…', () => this.act('open'), 'Ctrl+O'],
        ['Save project', () => this.act('save'), 'Ctrl+S'],
        ['Rename project…', () => this.rename()],
        sep,
        ['Import MIDI file…', () => this.act('importMidi')],
        ['Import chord progression…', () => this.act('chords')],
        ['Import sound file…', importSound],
        sep,
        ['Export audio / stems / MIDI…', () => this.act('export')],
      ]],
      ['Edit', [
        ['Undo', () => undo(), 'Ctrl+Z'],
        ['Redo', () => redo(), 'Ctrl+Y'],
        sep,
        ['Cut', edit('cut'), 'Ctrl+X'],
        ['Copy', edit('copy'), 'Ctrl+C'],
        ['Paste', edit('paste'), 'Ctrl+V'],
        ['Duplicate', edit('duplicate'), 'Ctrl+D'],
        ['Delete', edit('del'), 'Del'],
        sep,
        ['Select all', edit('selectAll'), 'Ctrl+A'],
      ]],
      ['Track', [
        ['Add instrument track…', () => openAddTrack()],
        ['Add track from sound file…', importSound],
        sep,
        ['Rename selected track…', () => tr() && UI.renameTrack(tr().id)],
        ['New pattern on selected track', () => UI.newPattern()],
        ['Clear selected track’s automation', () => { const t = tr(); if (t) { Auto.clear(App.song, t.id); toast('Automation cleared for ' + t.name); } }],
      ]],
      ['Tools', [
        ['✨ Compose / extend song…', () => openCompose('extend')],
        ['✍ Describe a song in words…', () => openCompose('describe')],
        ['＋ Add generated parts…', () => openCompose('add')],
        ['★ Generate a new song…', () => openCompose('new')],
        sep,
        ['Chord progression…', () => this.act('chords')],
        ['Connect MIDI keyboard', () => $('#btnMidi').click()],
      ]],
      ['View', [
        ['Playlist', () => UI.setView('arrange'), 'F5', () => App.view === 'arrange'],
        ['Piano roll', () => UI.setView('piano'), 'F7', () => App.view === 'piano'],
        ['Mixer + spectrum', () => UI.setView('mixer'), 'F9', () => App.view === 'mixer'],
        sep,
        ['Metronome', () => $('#btnMetro').click(), '', () => App.metronome],
        ['Typing piano', () => $('#btnTyping').click(), '', () => App.typingPiano],
        ['Loop region', () => $('#btnLoop').click(), '', () => App.song.loop.on],
      ]],
      ['Help', [
        ['Shortcuts & help', () => this.act('help'), '?'],
        ['About ChipForge', () => Modal.open('About ChipForge', h('div', null,
          h('p', null, 'ChipForge — an 8-bit music studio that runs in your browser.'),
          h('p', { class: 'dim' }, 'Chip synths, samples, piano roll, playlist, mixer, automation, and a composer that extends your song. Everything stays on your device.')))],
      ]],
    ];
  },
  act(name) { UI.actions[name](); },

  async rename() {
    const n = await askText('Project name', App.song.name);
    if (!n) return;
    pushUndo(); App.song.name = n; autosave(); this.syncName();
  },
  syncName() { const el = $('#projName'); if (el) el.textContent = App.song.name || 'Untitled'; },

  build() {
    const bar = $('#menubar'), list = bar.querySelector('.menus');
    for (const [title, items] of this.defs()) {
      const btn = h('button', { class: 'mbtn' }, title);
      btn.addEventListener('pointerdown', e => { e.preventDefault(); this.open && this.open.btn === btn ? this.close() : this.show(btn, items); });
      btn.addEventListener('pointerenter', () => { if (this.open && this.open.btn !== btn) this.show(btn, items); });
      list.append(btn);
    }
    $('#projName').onclick = () => this.rename();
    this.syncName();
    window.addEventListener('pointerdown', e => { if (this.open && !this.open.panel.contains(e.target) && !e.target.classList.contains('mbtn')) this.close(); }, true);
    window.addEventListener('keydown', e => { if (this.open && e.key === 'Escape') { e.stopPropagation(); this.close(); } }, true);
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
  },
  show(btn, items) {
    this.close();
    const panel = h('div', { class: 'mpanel' }, items.map(it => {
      if (!it) return h('div', { class: 'msep' });
      const [label, fn, key, checked] = it;
      return h('button', { class: 'mitem', onclick: () => { this.close(); fn(); } },
        h('span', { class: 'mchk' }, checked && checked() ? '✓' : ''), h('span', { class: 'mlab' }, label), h('span', { class: 'mkey' }, key || ''));
    }));
    document.body.append(panel);
    const r = btn.getBoundingClientRect();
    panel.style.left = Math.max(4, Math.min(r.left, window.innerWidth - panel.offsetWidth - 4)) + 'px';
    panel.style.top = r.bottom + 'px';
    btn.classList.add('on');
    this.open = { btn, panel };
  },
  close() {
    if (!this.open) return;
    this.open.btn.classList.remove('on');
    this.open.panel.remove();
    this.open = null;
  },
};
