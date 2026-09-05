(() => {
  const pieces = window.PIANO_PIECES || [];
  if (!pieces.length) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">No piano data found.</p>';
    return;
  }

  const els = {
    pieceSelect: document.getElementById('pieceSelect'),
    pieceComposer: document.getElementById('pieceComposer'),
    pieceTitle: document.getElementById('pieceTitle'),
    pieceDescription: document.getElementById('pieceDescription'),
    pieceMeta: document.getElementById('pieceMeta'),
    scoreSvg: document.getElementById('scoreSvg'),
    scorePanel: document.getElementById('scorePanel'),
    fallingPanel: document.getElementById('fallingPanel'),
    canvas: document.getElementById('fallingCanvas'),
    tabs: [...document.querySelectorAll('.view-tab')],
    playButton: document.getElementById('playButton'),
    playIcon: document.getElementById('playIcon'),
    playLabel: document.getElementById('playLabel'),
    restartButton: document.getElementById('restartButton'),
    progress: document.getElementById('progress'),
    currentTime: document.getElementById('currentTime'),
    totalTime: document.getElementById('totalTime'),
    tempo: document.getElementById('tempo'),
    tempoValue: document.getElementById('tempoValue'),
    soundToggle: document.getElementById('soundToggle')
  };

  const state = {
    piece: pieces[0],
    view: 'score',
    beat: 0,
    tempo: pieces[0].tempo,
    playing: false,
    lastFrame: null,
    previousBeat: 0,
    audioContext: null
  };

  const pitchClass = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
    F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8,
    A: 9, 'A#': 10, Bb: 10, B: 11
  };
  const letterIndex = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const blackPitchClasses = new Set([1, 3, 6, 8, 10]);

  function parsePitch(pitch) {
    const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch);
    if (!match) throw new Error(`Invalid pitch: ${pitch}`);
    return { letter: match[1], accidental: match[2], octave: Number(match[3]) };
  }

  function pitchToMidi(pitch) {
    const { letter, accidental, octave } = parsePitch(pitch);
    return (octave + 1) * 12 + pitchClass[letter + accidental];
  }

  function frequencyForPitch(pitch) {
    return 440 * Math.pow(2, (pitchToMidi(pitch) - 69) / 12);
  }

  function totalBeats(piece = state.piece) {
    return Math.max(...piece.notes.map(note => note.start + note.duration));
  }

  function secondsForBeats(beats, tempo = state.tempo) {
    return beats * 60 / tempo;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, seconds || 0);
    const minutes = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60).toString().padStart(2, '0');
    return `${minutes}:${secs}`;
  }

  function setPiece(piece) {
    pause();
    state.piece = piece;
    state.beat = 0;
    state.previousBeat = 0;
    state.tempo = piece.tempo;
    els.tempo.value = piece.tempo;
    els.tempoValue.textContent = `${piece.tempo} BPM`;
    renderPieceInfo();
    renderScore();
    updateTransport();
    drawFallingNotes();
  }

  function renderPieceInfo() {
    const piece = state.piece;
    els.pieceComposer.textContent = piece.composer;
    els.pieceTitle.textContent = piece.title;
    els.pieceDescription.textContent = piece.description;
    els.pieceMeta.innerHTML = '';
    const signature = `${piece.timeSignature[0]}/${piece.timeSignature[1]}`;
    [piece.key, signature, piece.level].forEach(value => {
      const pill = document.createElement('span');
      pill.className = 'meta-pill';
      pill.textContent = value;
      els.pieceMeta.appendChild(pill);
    });
  }

  function svgEl(name, attrs = {}, text = '') {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  }

  function diatonicIndex(pitch) {
    const { letter, octave } = parsePitch(pitch);
    return octave * 7 + letterIndex[letter];
  }

  function noteY(note, hand, staff) {
    const referencePitch = hand === 'right' ? 'E4' : 'G2';
    const steps = diatonicIndex(note.pitch) - diatonicIndex(referencePitch);
    return staff.bottom - steps * (staff.gap / 2);
  }

  function addLedgerLines(svg, x, y, staff) {
    const halfGap = staff.gap / 2;
    if (y < staff.top - halfGap) {
      for (let ly = staff.top - staff.gap; ly >= y - 1; ly -= staff.gap) {
        svg.appendChild(svgEl('line', { x1: x - 11, y1: ly, x2: x + 11, y2: ly, stroke: '#77736b', 'stroke-width': 1 }));
      }
    }
    if (y > staff.bottom + halfGap) {
      for (let ly = staff.bottom + staff.gap; ly <= y + 1; ly += staff.gap) {
        svg.appendChild(svgEl('line', { x1: x - 11, y1: ly, x2: x + 11, y2: ly, stroke: '#77736b', 'stroke-width': 1 }));
      }
    }
  }

  function renderScore() {
    const piece = state.piece;
    const beats = totalBeats(piece);
    const pxPerBeat = 54;
    const left = 112;
    const rightPad = 70;
    const width = Math.max(1180, left + beats * pxPerBeat + rightPad);
    const height = 420;
    const treble = { top: 96, bottom: 144, gap: 12 };
    const bass = { top: 248, bottom: 296, gap: 12 };

    const svg = els.scoreSvg;
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    svg.appendChild(svgEl('text', { x: 28, y: 122, 'font-size': 12, fill: '#77736b', 'font-weight': 700 }, 'RIGHT'));
    svg.appendChild(svgEl('text', { x: 34, y: 274, 'font-size': 12, fill: '#77736b', 'font-weight': 700 }, 'LEFT'));
    svg.appendChild(svgEl('text', { x: 68, y: 142, 'font-size': 48, fill: '#1e1e1b', 'font-family': 'serif' }, '𝄞'));
    svg.appendChild(svgEl('text', { x: 70, y: 294, 'font-size': 43, fill: '#1e1e1b', 'font-family': 'serif' }, '𝄢'));

    [treble, bass].forEach(staff => {
      for (let i = 0; i < 5; i += 1) {
        const y = staff.top + i * staff.gap;
        svg.appendChild(svgEl('line', { x1: left, y1: y, x2: width - rightPad, y2: y, stroke: '#77736b', 'stroke-width': 1 }));
      }
    });

    const beatsPerBar = piece.timeSignature[0];
    const bars = Math.ceil(beats / beatsPerBar);
    for (let bar = 0; bar <= bars; bar += 1) {
      const x = left + bar * beatsPerBar * pxPerBeat;
      [treble, bass].forEach(staff => {
        svg.appendChild(svgEl('line', {
          x1: x, y1: staff.top, x2: x, y2: staff.bottom,
          stroke: bar === 0 || bar === bars ? '#5c5953' : '#b3aea4',
          'stroke-width': bar === 0 || bar === bars ? 1.5 : 1
        }));
      });
      if (bar < bars) {
        svg.appendChild(svgEl('text', { x: x + 7, y: 72, 'font-size': 10, fill: '#aaa49a' }, String(bar + 1)));
      }
    }

    piece.notes.forEach((note, index) => {
      const staff = note.hand === 'right' ? treble : bass;
      const x = left + note.start * pxPerBeat + 18;
      const y = noteY(note, note.hand, staff);
      const group = svgEl('g', { 'data-note': index, 'data-start': note.start });
      addLedgerLines(group, x, y, staff);

      const parsed = parsePitch(note.pitch);
      if (parsed.accidental) {
        group.appendChild(svgEl('text', { x: x - 18, y: y + 5, 'font-size': 16, fill: '#1e1e1b', 'font-family': 'serif' }, parsed.accidental === '#' ? '♯' : '♭'));
      }

      const open = note.duration >= 2;
      group.appendChild(svgEl('ellipse', {
        cx: x, cy: y, rx: 7.5, ry: 5.3,
        fill: open ? '#fffdf8' : '#1e1e1b',
        stroke: '#1e1e1b', 'stroke-width': 1.7,
        transform: `rotate(-14 ${x} ${y})`
      }));

      if (note.duration < 4) {
        const stemUp = y > (staff.top + staff.bottom) / 2;
        group.appendChild(svgEl('line', {
          x1: stemUp ? x + 6 : x - 6,
          y1: y,
          x2: stemUp ? x + 6 : x - 6,
          y2: stemUp ? y - 34 : y + 34,
          stroke: '#1e1e1b', 'stroke-width': 1.5
        }));
      }

      if (state.view === 'letters') {
        const labelY = note.hand === 'right' ? Math.min(y - 18, staff.top - 18) : Math.max(y + 25, staff.bottom + 28);
        group.appendChild(svgEl('text', {
          x, y: labelY, 'text-anchor': 'middle', 'font-size': 12,
          fill: '#5f5a52', 'font-weight': 750
        }, `${parsed.letter}${parsed.accidental}`));
      }

      if (state.view === 'fingering' && note.finger) {
        const labelY = note.hand === 'right' ? Math.min(y - 18, staff.top - 18) : Math.max(y + 25, staff.bottom + 28);
        group.appendChild(svgEl('circle', { cx: x, cy: labelY - 4, r: 9, fill: '#eee9df', stroke: '#d7d0c4' }));
        group.appendChild(svgEl('text', {
          x, y: labelY, 'text-anchor': 'middle', 'font-size': 11,
          fill: '#3d3a35', 'font-weight': 750
        }, String(note.finger)));
      }

      svg.appendChild(group);
    });

    const playhead = svgEl('line', {
      id: 'scorePlayhead', x1: left, y1: 62, x2: left, y2: 326,
      stroke: '#bb4c3e', 'stroke-width': 2, opacity: 0.65
    });
    svg.appendChild(playhead);
    updateScorePlayhead();
  }

  function updateScorePlayhead() {
    const line = document.getElementById('scorePlayhead');
    if (!line) return;
    const x = 112 + state.beat * 54 + 18;
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
  }

  function keyboardRange() {
    const midis = state.piece.notes.map(note => pitchToMidi(note.pitch));
    let min = Math.max(21, Math.min(...midis) - 4);
    let max = Math.min(108, Math.max(...midis) + 4);
    while (min > 21 && min % 12 !== 0) min -= 1;
    while (max < 108 && max % 12 !== 0) max += 1;
    max = Math.min(108, max + 1);
    return [min, max];
  }

  function buildKeyboard(width) {
    const [minMidi, maxMidi] = keyboardRange();
    const whiteMidis = [];
    for (let midi = minMidi; midi <= maxMidi; midi += 1) {
      if (!blackPitchClasses.has(midi % 12)) whiteMidis.push(midi);
    }
    const whiteWidth = width / whiteMidis.length;
    const keys = new Map();
    whiteMidis.forEach((midi, index) => {
      keys.set(midi, { midi, black: false, x: index * whiteWidth, width: whiteWidth });
    });
    for (let midi = minMidi; midi <= maxMidi; midi += 1) {
      if (!blackPitchClasses.has(midi % 12)) continue;
      let previous = midi - 1;
      while (previous >= minMidi && blackPitchClasses.has(previous % 12)) previous -= 1;
      const previousKey = keys.get(previous);
      if (!previousKey) continue;
      const blackWidth = whiteWidth * 0.62;
      keys.set(midi, {
        midi,
        black: true,
        x: previousKey.x + whiteWidth - blackWidth / 2,
        width: blackWidth
      });
    }
    return { keys, whiteMidis, minMidi, maxMidi };
  }

  function resizeCanvas() {
    const rect = els.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
    const nextHeight = Math.max(1, Math.floor(rect.height * dpr));
    if (els.canvas.width !== nextWidth || els.canvas.height !== nextHeight) {
      els.canvas.width = nextWidth;
      els.canvas.height = nextHeight;
    }
    return { width: rect.width, height: rect.height, dpr };
  }

  function drawFallingNotes() {
    const { width, height, dpr } = resizeCanvas();
    const ctx = els.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#171715';
    ctx.fillRect(0, 0, width, height);

    const keyboardHeight = Math.min(118, Math.max(88, height * 0.18));
    const keyboardTop = height - keyboardHeight;
    const pixelsPerBeat = Math.max(55, Math.min(92, height * 0.13));
    const keyboard = buildKeyboard(width);

    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    for (let beat = Math.floor(state.beat); beat < state.beat + keyboardTop / pixelsPerBeat + 1; beat += 1) {
      const y = keyboardTop - (beat - state.beat) * pixelsPerBeat;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    state.piece.notes.forEach(note => {
      const midi = pitchToMidi(note.pitch);
      const key = keyboard.keys.get(midi);
      if (!key) return;
      const bottom = keyboardTop - (note.start - state.beat) * pixelsPerBeat;
      const blockHeight = Math.max(14, note.duration * pixelsPerBeat - 4);
      const y = bottom - blockHeight;
      if (y > keyboardTop || bottom < -20) return;

      ctx.fillStyle = note.hand === 'right' ? '#b9dff2' : '#e5bfa1';
      ctx.beginPath();
      const radius = Math.min(5, key.width * 0.18);
      if (ctx.roundRect) {
        ctx.roundRect(key.x + 2, y, Math.max(3, key.width - 4), blockHeight, radius);
      } else {
        ctx.rect(key.x + 2, y, Math.max(3, key.width - 4), blockHeight);
      }
      ctx.fill();

      if (key.width > 24 && blockHeight > 24) {
        ctx.fillStyle = 'rgba(20,20,18,.72)';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(parsePitch(note.pitch).letter, key.x + key.width / 2, Math.min(bottom - 8, y + 18));
      }
    });

    const active = new Set(
      state.piece.notes
        .filter(note => state.beat >= note.start && state.beat < note.start + note.duration)
        .map(note => pitchToMidi(note.pitch))
    );

    keyboard.whiteMidis.forEach(midi => {
      const key = keyboard.keys.get(midi);
      ctx.fillStyle = active.has(midi) ? '#f0d3b8' : '#f8f6ef';
      ctx.fillRect(key.x, keyboardTop, key.width + 0.5, keyboardHeight);
      ctx.strokeStyle = '#aaa69d';
      ctx.strokeRect(key.x, keyboardTop, key.width + 0.5, keyboardHeight);

      if (midi % 12 === 0 && key.width > 18) {
        ctx.fillStyle = '#77736b';
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`C${Math.floor(midi / 12) - 1}`, key.x + key.width / 2, height - 10);
      }
    });

    [...keyboard.keys.values()].filter(key => key.black).forEach(key => {
      ctx.fillStyle = active.has(key.midi) ? '#b88763' : '#252522';
      ctx.fillRect(key.x, keyboardTop, key.width, keyboardHeight * 0.61);
    });

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, keyboardTop);
    ctx.lineTo(width, keyboardTop);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('LEFT HAND', 14, 24);
    ctx.fillStyle = '#e5bfa1';
    ctx.fillRect(86, 15, 24, 10);
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.fillText('RIGHT HAND', 132, 24);
    ctx.fillStyle = '#b9dff2';
    ctx.fillRect(214, 15, 24, 10);
  }

  function ensureAudioContext() {
    if (!state.audioContext) {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioContext.state === 'suspended') state.audioContext.resume();
    return state.audioContext;
  }

  function playTone(note) {
    if (!els.soundToggle.checked) return;
    const audio = ensureAudioContext();
    const now = audio.currentTime;
    const duration = Math.max(0.08, secondsForBeats(note.duration) * 0.88);
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequencyForPitch(note.pitch);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(note.hand === 'right' ? 0.12 : 0.09, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  function playNotesCrossed(previousBeat, currentBeat) {
    if (currentBeat < previousBeat) return;
    state.piece.notes.forEach(note => {
      if (note.start >= previousBeat && note.start < currentBeat) playTone(note);
    });
  }

  function play() {
    if (state.beat >= totalBeats() - 0.001) state.beat = 0;
    state.previousBeat = state.beat;
    state.lastFrame = performance.now();
    state.playing = true;
    if (els.soundToggle.checked) ensureAudioContext();
    updatePlayButton();
  }

  function pause() {
    state.playing = false;
    state.lastFrame = null;
    updatePlayButton();
  }

  function restart() {
    pause();
    state.beat = 0;
    state.previousBeat = 0;
    updateTransport();
    drawFallingNotes();
  }

  function updatePlayButton() {
    els.playIcon.textContent = state.playing ? 'Ⅱ' : '▶';
    els.playLabel.textContent = state.playing ? 'Pause' : 'Play';
  }

  function updateTransport() {
    const beats = totalBeats();
    const fraction = beats ? state.beat / beats : 0;
    els.progress.value = Math.round(Math.max(0, Math.min(1, fraction)) * 1000);
    els.currentTime.textContent = formatTime(secondsForBeats(state.beat));
    els.totalTime.textContent = formatTime(secondsForBeats(beats));
    updateScorePlayhead();
  }

  function frame(timestamp) {
    if (state.playing) {
      if (state.lastFrame == null) state.lastFrame = timestamp;
      const deltaSeconds = Math.min(0.1, (timestamp - state.lastFrame) / 1000);
      state.lastFrame = timestamp;
      state.previousBeat = state.beat;
      state.beat += deltaSeconds * state.tempo / 60;
      playNotesCrossed(state.previousBeat, state.beat);

      if (state.beat >= totalBeats()) {
        state.beat = totalBeats();
        pause();
      }
      updateTransport();
    }

    if (state.view === 'falling') drawFallingNotes();
    requestAnimationFrame(frame);
  }

  function setView(view) {
    state.view = view;
    els.tabs.forEach(tab => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    const falling = view === 'falling';
    els.scorePanel.classList.toggle('is-hidden', falling);
    els.fallingPanel.classList.toggle('is-hidden', !falling);
    if (falling) {
      requestAnimationFrame(drawFallingNotes);
    } else {
      renderScore();
    }
  }

  pieces.forEach(piece => {
    const option = document.createElement('option');
    option.value = piece.id;
    option.textContent = `${piece.title} — ${piece.composer}`;
    els.pieceSelect.appendChild(option);
  });

  els.pieceSelect.addEventListener('change', event => {
    const piece = pieces.find(item => item.id === event.target.value);
    if (piece) setPiece(piece);
  });

  els.tabs.forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));

  els.playButton.addEventListener('click', () => {
    if (state.playing) pause(); else play();
  });

  els.restartButton.addEventListener('click', restart);

  els.progress.addEventListener('input', event => {
    const beats = totalBeats();
    state.beat = beats * Number(event.target.value) / 1000;
    state.previousBeat = state.beat;
    updateTransport();
    if (state.view === 'falling') drawFallingNotes();
  });

  els.tempo.addEventListener('input', event => {
    state.tempo = Number(event.target.value);
    els.tempoValue.textContent = `${state.tempo} BPM`;
    updateTransport();
  });

  window.addEventListener('resize', () => {
    if (state.view === 'falling') drawFallingNotes();
  });

  els.pieceSelect.value = state.piece.id;
  renderPieceInfo();
  renderScore();
  updateTransport();
  updatePlayButton();
  requestAnimationFrame(frame);
})();
