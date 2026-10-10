(() => {
  const pieces = window.PIANO_PIECES || [];
  if (!pieces.length) {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:sans-serif">No piano data found.</p>';
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
    audioContext: null,
    fallingCache: new WeakMap(),
    beatAnchor: 0,
    audioAnchor: 0,
    noteCursor: 0,
    scheduled: [],
    schedulerId: null
  };

  const TEMPO_MIN = 30;
  const TEMPO_MAX = 240;
  const SCHEDULE_AHEAD = 0.35;
  const BACKGROUND_SCHEDULE_AHEAD = 3;

  const naturalPitchClass = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const letterIndex = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const blackPitchClasses = new Set([1, 3, 6, 8, 10]);

  function parsePitch(pitch) {
    const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch);
    if (!match) throw new Error(`Invalid pitch: ${pitch}`);
    return { letter: match[1], accidental: match[2], octave: Number(match[3]) };
  }

  function pitchToMidi(pitch) {
    const { letter, accidental, octave } = parsePitch(pitch);
    const accidentalOffset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
    const midi = (octave + 1) * 12 + naturalPitchClass[letter] + accidentalOffset;
    if (!Number.isFinite(midi)) throw new Error(`Invalid MIDI pitch: ${pitch}`);
    return midi;
  }

  function safePitchToMidi(pitch) {
    try {
      const midi = pitchToMidi(pitch);
      return Number.isFinite(midi) ? midi : null;
    } catch (error) {
      console.warn('Skipping invalid pitch', pitch, error);
      return null;
    }
  }

  function frequencyForPitch(pitch) {
    return 440 * Math.pow(2, (pitchToMidi(pitch) - 69) / 12);
  }

  function noteEnd(piece = state.piece) {
    if (!piece) return 0;
    if (piece.__noteEndSource === piece.notes && Number.isFinite(piece.__noteEnd))
      return piece.__noteEnd;
    let max = 0;
    for (const note of piece.notes || []) {
      const end = Number(note.start) + Number(note.duration);
      if (Number.isFinite(end) && end > max) max = end;
    }
    piece.__noteEnd = max;
    piece.__noteEndSource = piece.notes;
    return max;
  }

  function quarterLength(beats, beatType) {
    const beatCount = Number(beats);
    const type = Number(beatType);
    if (!(beatCount > 0) || !(type > 0)) return 4;
    return beatCount * (4 / type);
  }

  function pieceBars(piece = state.piece) {
    if (!piece) return [];
    if (Array.isArray(piece.bars) && piece.bars.length) return piece.bars;
    if (piece.__barsSource === piece.notes && Array.isArray(piece.__bars)) return piece.__bars;
    const [beats, beatType] = piece.timeSignature || [4, 4];
    const length = quarterLength(beats, beatType);
    const limit = Math.max(noteEnd(piece), length);
    const bars = [];
    let start = 0;
    let number = 1;
    while (start < limit - 1e-6 && bars.length < 10000) {
      bars.push({
        start,
        end: start + length,
        number,
        implicit: false,
        beats: Number(beats) || 4,
        beatType: Number(beatType) || 4
      });
      start += length;
      number += 1;
    }
    piece.__bars = bars;
    piece.__barsSource = piece.notes;
    return bars;
  }

  function totalBeats(piece = state.piece) {
    const bars = Array.isArray(piece?.bars) ? piece.bars : null;
    const barEnd = bars?.length ? Number(bars[bars.length - 1].end) : 0;
    return Math.max(noteEnd(piece), Number.isFinite(barEnd) ? barEnd : 0);
  }

  function playbackNotes(piece = state.piece) {
    if (!piece?.notes) return [];
    if (piece.__playbackSource === piece.notes && Array.isArray(piece.__playback))
      return piece.__playback;
    const items = [];
    let maxDuration = 0;
    piece.notes.forEach((note, index) => {
      const start = Number(note.start);
      const duration = Number(note.duration);
      if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return;
      items.push({ note, index, start, duration });
      if (duration > maxDuration) maxDuration = duration;
    });
    items.sort((a, b) => a.start - b.start || a.index - b.index);
    piece.__playback = items;
    piece.__playbackSource = piece.notes;
    piece.__maxDuration = maxDuration;
    return items;
  }

  function lowerBound(items, beat) {
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].start < beat) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function upperBound(items, beat) {
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].start <= beat) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function secondsForBeats(beats, tempo = state.tempo) {
    return (beats * 60) / tempo;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, seconds || 0);
    const minutes = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60)
      .toString()
      .padStart(2, '0');
    return `${minutes}:${secs}`;
  }

  function fallingData(piece = state.piece) {
    if (!piece || !Array.isArray(piece.notes)) return { notes: [], minMidi: 48, maxMidi: 72 };
    const cached = state.fallingCache.get(piece);
    if (cached && cached.sourceLength === piece.notes.length) return cached;

    const notes = piece.notes
      .map(note => {
        const midi = safePitchToMidi(note.pitch);
        const start = Number(note.start);
        const duration = Number(note.duration);
        if (
          !Number.isFinite(midi) ||
          !Number.isFinite(start) ||
          !Number.isFinite(duration) ||
          duration <= 0
        )
          return null;
        return { note, midi, start, duration };
      })
      .filter(Boolean);

    notes.sort((a, b) => a.start - b.start);
    let minMidi = Infinity;
    let maxMidi = -Infinity;
    let maxDuration = 0;
    notes.forEach(item => {
      minMidi = Math.min(minMidi, item.midi);
      maxMidi = Math.max(maxMidi, item.midi);
      if (item.duration > maxDuration) maxDuration = item.duration;
    });
    if (!notes.length) {
      minMidi = 48;
      maxMidi = 72;
    }
    const data = {
      sourceLength: piece.notes.length,
      notes,
      maxDuration,
      minMidi,
      maxMidi
    };
    state.fallingCache.set(piece, data);
    return data;
  }

  function setPiece(piece) {
    pause();
    state.piece = piece;
    state.beat = 0;
    const requestedTempo = Number.isFinite(Number(piece.tempo)) ? Number(piece.tempo) : 90;
    state.tempo = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, requestedTempo));
    els.tempo.min = String(TEMPO_MIN);
    els.tempo.max = String(TEMPO_MAX);
    els.tempo.value = String(state.tempo);
    els.tempoValue.textContent = `${Math.round(state.tempo)} BPM`;
    renderPieceInfo();
    renderScore();
    updateTransport();
    if (state.view === 'falling') requestFallingRedraw();
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
        svg.appendChild(
          svgEl('line', {
            x1: x - 11,
            y1: ly,
            x2: x + 11,
            y2: ly,
            stroke: '#77736b',
            'stroke-width': 1
          })
        );
      }
    }
    if (y > staff.bottom + halfGap) {
      for (let ly = staff.bottom + staff.gap; ly <= y + 1; ly += staff.gap) {
        svg.appendChild(
          svgEl('line', {
            x1: x - 11,
            y1: ly,
            x2: x + 11,
            y2: ly,
            stroke: '#77736b',
            'stroke-width': 1
          })
        );
      }
    }
  }

  function renderScore() {
    const piece = state.piece;
    const bars = pieceBars(piece);
    const beats = bars.length ? bars[bars.length - 1].end : totalBeats(piece);
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

    svg.appendChild(
      svgEl(
        'text',
        { x: 28, y: 122, 'font-size': 12, fill: '#77736b', 'font-weight': 700 },
        'RIGHT'
      )
    );
    svg.appendChild(
      svgEl('text', { x: 34, y: 274, 'font-size': 12, fill: '#77736b', 'font-weight': 700 }, 'LEFT')
    );
    svg.appendChild(
      svgEl(
        'text',
        { x: 68, y: 142, 'font-size': 48, fill: '#1e1e1b', 'font-family': 'serif' },
        '𝄞'
      )
    );
    svg.appendChild(
      svgEl(
        'text',
        { x: 70, y: 294, 'font-size': 43, fill: '#1e1e1b', 'font-family': 'serif' },
        '𝄢'
      )
    );

    [treble, bass].forEach(staff => {
      for (let i = 0; i < 5; i += 1) {
        const y = staff.top + i * staff.gap;
        svg.appendChild(
          svgEl('line', {
            x1: left,
            y1: y,
            x2: width - rightPad,
            y2: y,
            stroke: '#77736b',
            'stroke-width': 1
          })
        );
      }
    });

    const barline = (x, strong) => {
      [treble, bass].forEach(staff => {
        svg.appendChild(
          svgEl('line', {
            x1: x,
            y1: staff.top,
            x2: x,
            y2: staff.bottom,
            stroke: strong ? '#5c5953' : '#b3aea4',
            'stroke-width': strong ? 1.5 : 1
          })
        );
      });
    };
    let previousSignature = '';
    bars.forEach((bar, index) => {
      const x = left + bar.start * pxPerBeat;
      barline(x, index === 0);
      if (!bar.implicit && bar.number != null) {
        svg.appendChild(
          svgEl('text', { x: x + 7, y: 72, 'font-size': 10, fill: '#aaa49a' }, String(bar.number))
        );
      }
      const signature = `${bar.beats}/${bar.beatType}`;
      if (signature !== previousSignature) {
        svg.appendChild(
          svgEl(
            'text',
            {
              x: x + 8,
              y: 88,
              'font-size': 12,
              fill: '#5c5953',
              'font-weight': 700
            },
            signature
          )
        );
        previousSignature = signature;
      }
    });
    if (bars.length) barline(left + bars[bars.length - 1].end * pxPerBeat, true);

    piece.notes.forEach((note, index) => {
      const staff = note.hand === 'right' ? treble : bass;
      const x = left + note.start * pxPerBeat + 18;
      const y = noteY(note, note.hand, staff);
      const group = svgEl('g', { 'data-note': index, 'data-start': note.start });
      addLedgerLines(group, x, y, staff);

      const parsed = parsePitch(note.pitch);
      if (parsed.accidental) {
        group.appendChild(
          svgEl(
            'text',
            { x: x - 18, y: y + 5, 'font-size': 16, fill: '#1e1e1b', 'font-family': 'serif' },
            parsed.accidental === '#' ? '♯' : '♭'
          )
        );
      }

      const open = note.duration >= 2;
      group.appendChild(
        svgEl('ellipse', {
          cx: x,
          cy: y,
          rx: 7.5,
          ry: 5.3,
          fill: open ? '#fffdf8' : '#1e1e1b',
          stroke: '#1e1e1b',
          'stroke-width': 1.7,
          transform: `rotate(-14 ${x} ${y})`
        })
      );

      if (note.duration < 4) {
        const stemUp = y > (staff.top + staff.bottom) / 2;
        group.appendChild(
          svgEl('line', {
            x1: stemUp ? x + 6 : x - 6,
            y1: y,
            x2: stemUp ? x + 6 : x - 6,
            y2: stemUp ? y - 34 : y + 34,
            stroke: '#1e1e1b',
            'stroke-width': 1.5
          })
        );
      }

      if (state.view === 'letters') {
        const labelY =
          note.hand === 'right'
            ? Math.min(y - 18, staff.top - 18)
            : Math.max(y + 25, staff.bottom + 28);
        group.appendChild(
          svgEl(
            'text',
            {
              x,
              y: labelY,
              'text-anchor': 'middle',
              'font-size': 12,
              fill: '#5f5a52',
              'font-weight': 750
            },
            `${parsed.letter}${parsed.accidental}`
          )
        );
      }

      if (state.view === 'fingering' && note.finger) {
        const labelY =
          note.hand === 'right'
            ? Math.min(y - 18, staff.top - 18)
            : Math.max(y + 25, staff.bottom + 28);
        group.appendChild(
          svgEl('circle', { cx: x, cy: labelY - 4, r: 9, fill: '#eee9df', stroke: '#d7d0c4' })
        );
        group.appendChild(
          svgEl(
            'text',
            {
              x,
              y: labelY,
              'text-anchor': 'middle',
              'font-size': 11,
              fill: '#3d3a35',
              'font-weight': 750
            },
            String(note.finger)
          )
        );
      }

      svg.appendChild(group);
    });

    const playhead = svgEl('line', {
      id: 'scorePlayhead',
      x1: left,
      y1: 62,
      x2: left,
      y2: 326,
      stroke: '#bb4c3e',
      'stroke-width': 2,
      opacity: 0.65
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

  function isBlackMidi(midi) {
    return blackPitchClasses.has(((midi % 12) + 12) % 12);
  }

  function keyboardRange() {
    const { minMidi, maxMidi } = fallingData();
    let min = Math.max(21, Math.floor(minMidi) - 4);
    let max = Math.min(108, Math.ceil(maxMidi) + 4);
    while (min > 21 && min % 12 !== 0) min -= 1;
    while (max < 108 && max % 12 !== 0) max += 1;
    if (isBlackMidi(min)) min = Math.max(21, min - 1);
    if (isBlackMidi(max)) max = Math.min(108, max + (max < 108 ? 1 : -1));
    if (isBlackMidi(max)) max -= 1;
    return [min, max];
  }

  function buildKeyboard(width) {
    const [minMidi, maxMidi] = keyboardRange();
    const whiteMidis = [];
    for (let midi = minMidi; midi <= maxMidi; midi += 1) {
      if (!blackPitchClasses.has(((midi % 12) + 12) % 12)) whiteMidis.push(midi);
    }
    if (!whiteMidis.length) whiteMidis.push(60);
    const whiteWidth = width / whiteMidis.length;
    const keys = new Map();
    whiteMidis.forEach((midi, index) => {
      keys.set(midi, { midi, black: false, x: index * whiteWidth, width: whiteWidth });
    });
    for (let midi = minMidi; midi <= maxMidi; midi += 1) {
      if (!blackPitchClasses.has(((midi % 12) + 12) % 12)) continue;
      let previous = midi - 1;
      while (previous >= minMidi && blackPitchClasses.has(((previous % 12) + 12) % 12))
        previous -= 1;
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
    if (rect.width < 2 || rect.height < 2) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(2, Math.floor(rect.width * dpr));
    const nextHeight = Math.max(2, Math.floor(rect.height * dpr));
    if (els.canvas.width !== nextWidth || els.canvas.height !== nextHeight) {
      els.canvas.width = nextWidth;
      els.canvas.height = nextHeight;
    }
    return { width: rect.width, height: rect.height, dpr };
  }

  function drawFallingNotes() {
    if (state.view !== 'falling' || els.fallingPanel.classList.contains('is-hidden')) return;
    const size = resizeCanvas();
    if (!size) return;
    const { width, height, dpr } = size;
    const ctx = els.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#171715';
    ctx.fillRect(0, 0, width, height);

    const keyboardHeight = Math.min(118, Math.max(88, height * 0.18));
    const keyboardTop = height - keyboardHeight;
    const pixelsPerBeat = Math.max(55, Math.min(92, height * 0.13));
    const keyboard = buildKeyboard(width);
    const data = fallingData();

    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    for (
      let beat = Math.floor(state.beat);
      beat < state.beat + keyboardTop / pixelsPerBeat + 1;
      beat += 1
    ) {
      const y = keyboardTop - (beat - state.beat) * pixelsPerBeat;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const lookAheadBeats = keyboardTop / pixelsPerBeat + 2;
    const visibleFrom = lowerBound(data.notes, state.beat - 0.25 - (data.maxDuration || 0));
    for (let index = visibleFrom; index < data.notes.length; index += 1) {
      const item = data.notes[index];
      if (item.start > state.beat + lookAheadBeats) break;
      if (item.start + item.duration < state.beat - 0.25) continue;
      const key = keyboard.keys.get(Math.round(item.midi));
      if (!key) continue;
      const bottom = keyboardTop - (item.start - state.beat) * pixelsPerBeat;
      const blockHeight = Math.max(14, item.duration * pixelsPerBeat - 4);
      const y = bottom - blockHeight;
      if (y > keyboardTop || bottom < -20) continue;

      ctx.fillStyle = item.note.hand === 'right' ? '#b9dff2' : '#e5bfa1';
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
        const parsed = parsePitch(item.note.pitch);
        ctx.fillText(
          `${parsed.letter}${parsed.accidental}`,
          key.x + key.width / 2,
          Math.min(bottom - 8, y + 18)
        );
      }
    }

    const active = new Set();
    const activeFrom = lowerBound(data.notes, state.beat - (data.maxDuration || 0));
    for (let index = activeFrom; index < data.notes.length; index += 1) {
      const item = data.notes[index];
      if (item.start > state.beat) break;
      if (state.beat < item.start + item.duration) active.add(Math.round(item.midi));
    }

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

    [...keyboard.keys.values()]
      .filter(key => key.black)
      .forEach(key => {
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

    if (!data.notes.length) {
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No playable notes available for falling-notes view', width / 2, height / 2);
    }
  }

  let fallingRedrawQueued = false;
  function requestFallingRedraw() {
    if (fallingRedrawQueued) return;
    fallingRedrawQueued = true;
    requestAnimationFrame(() => {
      fallingRedrawQueued = false;
      drawFallingNotes();
    });
  }

  function ensureAudioContext() {
    if (!state.audioContext) {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioContext.state === 'suspended') state.audioContext.resume();
    return state.audioContext;
  }

  function stopSounding() {
    const audio = state.audioContext;
    const now = audio ? audio.currentTime : 0;
    state.scheduled.forEach(item => {
      try {
        item.gain.gain.cancelScheduledValues(now);
        item.gain.gain.setValueAtTime(Math.max(item.gain.gain.value, 0.0001), now);
        item.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
        item.oscillator.stop(now + 0.04);
      } catch (error) {
        console.warn('Could not stop a scheduled note', error);
      }
    });
    state.scheduled = [];
  }

  function scheduleTone(note, when, durationBeats = note.duration) {
    if (!els.soundToggle.checked || !(durationBeats > 0.02)) return;
    const audio = ensureAudioContext();
    const startAt = Math.max(when, audio.currentTime);
    const duration = Math.max(0.08, secondsForBeats(durationBeats) * 0.88);
    let frequency = 0;
    try {
      frequency = frequencyForPitch(note.pitch);
    } catch (error) {
      console.warn('Skipping invalid audio pitch', note.pitch, error);
      return;
    }
    if (!Number.isFinite(frequency) || frequency <= 0) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(note.hand === 'right' ? 0.12 : 0.09, startAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
    state.scheduled.push({ oscillator, gain, when: startAt });
  }

  function beatNow() {
    if (!state.playing || !state.audioContext) return state.beat;
    return (
      state.beatAnchor + ((state.audioContext.currentTime - state.audioAnchor) * state.tempo) / 60
    );
  }

  function audioTimeForBeat(beat) {
    return state.audioAnchor + ((beat - state.beatAnchor) * 60) / state.tempo;
  }

  function soundActiveNotes(beat) {
    const notes = playbackNotes();
    const maxDuration = state.piece?.__maxDuration || 0;
    const from = lowerBound(notes, beat - maxDuration);
    const audio = ensureAudioContext();
    for (let index = from; index < notes.length; index += 1) {
      const item = notes[index];
      if (item.start > beat) break;
      const remaining = item.start + item.duration - beat;
      if (remaining > 0.02) scheduleTone(item.note, audio.currentTime, remaining);
    }
  }

  function scheduleAhead(horizonSeconds) {
    if (!state.playing || !state.audioContext) return;
    const notes = playbackNotes();
    const horizon = state.audioContext.currentTime + horizonSeconds;
    while (state.noteCursor < notes.length) {
      const item = notes[state.noteCursor];
      const when = audioTimeForBeat(item.start);
      if (when > horizon) break;
      if (when >= state.audioContext.currentTime - 0.03)
        scheduleTone(item.note, when, item.duration);
      state.noteCursor += 1;
    }
  }

  function armScheduler(beat) {
    state.noteCursor = upperBound(playbackNotes(), beat);
    if (els.soundToggle.checked) soundActiveNotes(beat);
    scheduleAhead(document.hidden ? BACKGROUND_SCHEDULE_AHEAD : SCHEDULE_AHEAD);
  }

  function ensureScheduler() {
    if (state.schedulerId != null) return;
    state.schedulerId = window.setInterval(() => {
      if (!state.playing) return;
      scheduleAhead(document.hidden ? BACKGROUND_SCHEDULE_AHEAD : SCHEDULE_AHEAD);
    }, 25);
  }

  function anchorClock(beat) {
    const audio = ensureAudioContext();
    state.beatAnchor = beat;
    state.audioAnchor = audio.currentTime;
  }

  function seekTo(beat, { keepPlaying = state.playing } = {}) {
    const limit = totalBeats();
    state.beat = Math.max(0, Math.min(limit, beat));
    if (keepPlaying) {
      stopSounding();
      anchorClock(state.beat);
      armScheduler(state.beat);
    }
    updateTransport();
    if (state.view === 'falling') requestFallingRedraw();
  }

  function play() {
    if (state.beat >= totalBeats() - 0.001) state.beat = 0;
    state.playing = true;
    anchorClock(state.beat);
    armScheduler(state.beat);
    ensureScheduler();
    updatePlayButton();
  }

  function pause() {
    if (state.playing) state.beat = Math.min(totalBeats(), Math.max(0, beatNow()));
    state.playing = false;
    stopSounding();
    updatePlayButton();
    updateTransport();
    if (state.view === 'falling') requestFallingRedraw();
  }

  function restart() {
    state.playing = false;
    stopSounding();
    state.beat = 0;
    updatePlayButton();
    updateTransport();
    if (state.view === 'falling') requestFallingRedraw();
  }

  function stepBar(direction) {
    const beat = state.playing ? beatNow() : state.beat;
    const bars = pieceBars();
    if (!bars.length) return;
    if (direction > 0) {
      const next = bars.find(bar => bar.start > beat + 0.04);
      seekTo(next ? next.start : totalBeats());
      return;
    }
    let target = bars[0].start;
    bars.forEach(bar => {
      if (bar.start < beat - 0.04) target = bar.start;
    });
    seekTo(target);
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

  function frame() {
    if (state.playing) {
      state.beat = beatNow();
      if (state.beat >= totalBeats()) {
        state.beat = totalBeats();
        pause();
      } else {
        updateTransport();
        if (state.view === 'falling') drawFallingNotes();
      }
    }
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
      requestFallingRedraw();
      requestAnimationFrame(() => requestFallingRedraw());
    } else {
      renderScore();
    }
  }

  const demoGroup = document.getElementById('demoPieces');
  pieces.forEach(piece => {
    const option = document.createElement('option');
    option.value = piece.id;
    option.textContent = `${piece.title} — ${piece.composer}`;
    (demoGroup || els.pieceSelect).appendChild(option);
  });

  els.pieceSelect.addEventListener('change', event => {
    const piece = pieces.find(item => item.id === event.target.value);
    if (piece) setPiece(piece);
  });

  els.tabs.forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));

  els.playButton.addEventListener('click', () => {
    if (state.playing) pause();
    else play();
  });

  els.restartButton.addEventListener('click', restart);

  els.progress.addEventListener('input', event => {
    seekTo((totalBeats() * Number(event.target.value)) / 1000);
  });

  els.tempo.addEventListener('input', event => {
    const beat = state.playing ? beatNow() : state.beat;
    state.tempo = Number(event.target.value);
    els.tempoValue.textContent = `${state.tempo} BPM`;
    if (state.playing) {
      state.beat = beat;
      stopSounding();
      anchorClock(beat);
      armScheduler(beat);
    }
    updateTransport();
  });

  els.soundToggle.addEventListener('change', () => {
    if (!els.soundToggle.checked) {
      stopSounding();
      return;
    }
    if (state.playing) armScheduler(beatNow());
  });

  window.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = event.target?.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      event.target?.isContentEditable
    )
      return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (state.playing) pause();
      else play();
    } else if (event.code === 'ArrowRight') {
      event.preventDefault();
      stepBar(1);
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault();
      stepBar(-1);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (state.playing) scheduleAhead(document.hidden ? BACKGROUND_SCHEDULE_AHEAD : SCHEDULE_AHEAD);
  });

  window.addEventListener('resize', requestFallingRedraw);
  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => requestFallingRedraw());
    resizeObserver.observe(els.fallingPanel);
  }

  els.pieceSelect.value = state.piece.id;
  renderPieceInfo();
  renderScore();
  updateTransport();
  updatePlayButton();
  requestAnimationFrame(frame);

  window.PianoApp = {
    redrawFalling: requestFallingRedraw,
    setPiece,
    keyboardRange,
    getState: () => ({
      piece: state.piece,
      view: state.view,
      beat: state.beat,
      tempo: state.tempo,
      playing: state.playing
    })
  };
})();
