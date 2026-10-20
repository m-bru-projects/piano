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
    osmdContainer: document.getElementById('osmdContainer'),
    scoreStage: document.getElementById('scoreStage'),
    scoreLabels: document.getElementById('scoreLabels'),
    renderNote: document.getElementById('renderNote'),
    scorePanel: document.getElementById('scorePanel'),
    fallingPanel: document.getElementById('fallingPanel'),
    readingPanel: document.getElementById('readingPanel'),
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
    toneSelect: document.getElementById('toneSelect'),
    volume: document.getElementById('volume'),
    reverbToggle: document.getElementById('reverbToggle'),
    soundToggle: document.getElementById('soundToggle'),
    soundStatus: document.getElementById('soundStatus')
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
    schedulerId: null,
    osmd: null,
    cursorBeats: [],
    cursorIndex: 0,
    scoreLabels: [],
    renderToken: 0
  };

  const TEMPO_MIN = 30;
  const TEMPO_MAX = 240;
  const SCHEDULE_AHEAD = 0.35;
  const BACKGROUND_SCHEDULE_AHEAD = 3;

  const naturalPitchClass = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
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

  function ensureMusicXml(piece) {
    if (!piece) return '';
    if (typeof piece.musicXml === 'string' && piece.musicXml.includes('<score-partwise')) {
      return piece.musicXml;
    }
    if (typeof notesToMusicXml !== 'function') return '';
    piece.musicXml = notesToMusicXml(piece);
    return piece.musicXml;
  }

  function osmdOptions(drawFingerings) {
    return {
      backend: 'svg',
      autoResize: true,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      drawPartAbbreviations: false,
      drawFingerings,
      fingeringPosition: 'above',
      drawMeasureNumbers: true,
      drawTimeSignatures: true,
      drawMetronomeMarks: true,
      autoBeam: true,
      followCursor: false,
      cursorsOptions: [{ type: 0, color: '#bb4c3e', alpha: 0.45, follow: false }]
    };
  }

  function setRenderNote(message) {
    if (els.renderNote) els.renderNote.textContent = message;
  }

  function pitchNameFromOsmd(pitch) {
    const raw = typeof pitch?.ToStringShort === 'function' ? pitch.ToStringShort(0) : '';
    const match = /^([A-G])([#b]*)n?/.exec(raw);
    const frequency = Number(pitch?.Frequency);
    if (!match || !Number.isFinite(frequency) || frequency <= 0) {
      const name = raw.replace(/(-?\d+)$/, '');
      return { fullName: raw, name };
    }
    // ToStringShort uses OSMD's internal octave, which is three below scientific pitch.
    const midi = Math.round(12 * Math.log2(frequency / 440) + 69);
    const octave = Math.floor(midi / 12) - 1;
    return {
      fullName: `${match[1]}${match[2]}${octave}`,
      name: `${match[1]}${match[2]}`
    };
  }

  function modelNoteAt(name, beat) {
    const notes = state.piece?.notes || [];
    for (let index = 0; index < notes.length; index += 1) {
      const note = notes[index];
      if (note.pitch !== name) continue;
      if (Math.abs(beat - Number(note.start)) <= 0.08) return note;
    }
    return null;
  }

  function updateScoreAnnotations() {
    const layer = els.scoreLabels;
    if (!layer) return;
    layer.replaceChildren();
    const letters = state.view === 'letters';
    const fingering = state.view === 'fingering';
    if (!letters && !fingering) return;
    state.scoreLabels.forEach(label => {
      if (letters && label.name) {
        const node = document.createElement('span');
        node.className = label.below ? 'score-label is-below' : 'score-label';
        node.textContent = label.name;
        node.style.left = `${label.x}px`;
        node.style.top = `${label.y}px`;
        layer.appendChild(node);
      }
      if (!fingering) return;
      const model = modelNoteAt(label.fullName, label.beat);
      if (!model?.generatedFinger || !model.finger) return;
      const node = document.createElement('span');
      node.className = label.below
        ? 'score-finger is-generated is-below'
        : 'score-finger is-generated';
      node.textContent = String(model.finger);
      node.style.left = `${label.x}px`;
      node.style.top = `${label.y}px`;
      layer.appendChild(node);
    });
  }

  function noteheadBox(gNote) {
    const shape = gNote.PositionAndShape;
    const position = shape?.AbsolutePosition;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
    const unit = 10 * (state.osmd?.zoom || 1);
    const width = Number(shape.Size?.width) || 0;
    const height = Number(shape.Size?.height) || 1;
    return {
      x: position.x * unit + (width * unit) / 2,
      top: position.y * unit,
      bottom: (position.y + height) * unit
    };
  }

  function spreadScoreLabels(labels) {
    const groups = new Map();
    labels.forEach(label => {
      const key = `${label.below ? 'below' : 'above'}|${label.beat.toFixed(2)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(label);
    });
    groups.forEach(group => {
      group.sort((a, b) => a.x - b.x);
      for (let index = 1; index < group.length; index += 1) {
        if (group[index].x - group[index - 1].x < 16) {
          group[index].x = group[index - 1].x + 16;
        }
      }
    });
  }

  function indexScoreCursor() {
    const osmd = state.osmd;
    const cursor = osmd?.cursor;
    if (!cursor?.iterator) return;
    try {
      indexScoreCursorSteps(cursor);
    } catch (error) {
      console.error(error);
      state.cursorBeats = [];
      state.scoreLabels = [];
    }
  }

  function indexScoreCursorSteps(cursor) {
    cursor.reset();
    const beats = [];
    const labels = [];
    while (!cursor.iterator.EndReached) {
      const whole = cursor.iterator.CurrentSourceTimestamp?.RealValue || 0;
      const beat = whole * 4;
      beats.push(beat);
      (cursor.GNotesUnderCursor() || []).forEach(gNote => {
        const source = gNote.sourceNote;
        if (!source || source.isRest()) return;
        const pitch = source.Pitch;
        const box = noteheadBox(gNote);
        if (!pitch || !box) return;
        const names = pitchNameFromOsmd(pitch);
        const model = modelNoteAt(names.fullName, beat);
        const below = model?.hand === 'left';
        labels.push({
          name: names.name,
          fullName: names.fullName,
          x: box.x,
          y: below ? box.bottom + 3 : box.top - 2,
          below,
          beat
        });
      });
      cursor.next();
    }
    spreadScoreLabels(labels);
    cursor.reset();
    cursor.show();
    state.cursorBeats = beats;
    state.cursorIndex = 0;
    state.scoreLabels = labels;
    updateScoreAnnotations();
  }

  function scrollScoreCursor() {
    const cursorElement = state.osmd?.cursor?.cursorElement;
    const scroller = document.getElementById('scoreScroll');
    if (!cursorElement || !scroller || state.view === 'falling') return;
    const cursorBox = cursorElement.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    if (cursorBox.height <= 0) return;
    if (cursorBox.top < frame.top + 20) {
      scroller.scrollTop -= frame.top + 20 - cursorBox.top;
    } else if (cursorBox.bottom > frame.bottom - 20) {
      scroller.scrollTop += cursorBox.bottom - (frame.bottom - 20);
    }
  }

  function syncScoreCursor(beat) {
    const cursor = state.osmd?.cursor;
    const beats = state.cursorBeats;
    if (!cursor || !beats?.length) return;
    let lo = 0;
    let hi = beats.length - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= beat + 0.02) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found === state.cursorIndex) return;
    if (found === state.cursorIndex - 1 && typeof cursor.previous === 'function') {
      cursor.previous();
    } else if (found > state.cursorIndex && found - state.cursorIndex < 12) {
      while (state.cursorIndex < found) {
        cursor.next();
        state.cursorIndex += 1;
      }
    } else {
      cursor.reset();
      for (let index = 0; index < found; index += 1) cursor.next();
    }
    state.cursorIndex = found;
    cursor.show();
    scrollScoreCursor();
  }

  const SHEET_NOTE_RADIUS = 1.8;
  const SHEET_SYSTEM_SLACK = 4;

  function wholeToBeats(value) {
    const whole = Number(value?.RealValue ?? value);
    return Number.isFinite(whole) ? whole * 4 : null;
  }

  function shapeBounds(shape) {
    const position = shape?.AbsolutePosition;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
    const borderLeft = Number(shape.BorderLeft);
    const borderRight = Number(shape.BorderRight);
    const borderTop = Number(shape.BorderTop);
    const borderBottom = Number(shape.BorderBottom);
    const width = Number(shape.Size?.width);
    const height = Number(shape.Size?.height);
    const left = position.x + (Number.isFinite(borderLeft) ? borderLeft : 0);
    const right =
      position.x +
      (Number.isFinite(borderRight) ? borderRight : Number.isFinite(width) ? width : 0);
    const top = position.y + (Number.isFinite(borderTop) ? borderTop : 0);
    const bottom =
      position.y +
      (Number.isFinite(borderBottom) ? borderBottom : Number.isFinite(height) ? height : 0);
    if (!(right > left + 0.01)) return null;
    return {
      left,
      right,
      top: Math.min(top, bottom),
      bottom: Math.max(top, bottom)
    };
  }

  function beatUnitFor(startBeat) {
    const bars = pieceBars();
    let match = null;
    for (const bar of bars) {
      if (startBeat >= bar.start - 0.03 && startBeat < bar.end - 0.03) {
        match = bar;
        break;
      }
    }
    const beatType = Number(match?.beatType || state.piece?.timeSignature?.[1]) || 4;
    const unit = 4 / beatType;
    return unit > 0 && Number.isFinite(unit) ? unit : 1;
  }

  function readSheetHitModel() {
    const pages = state.osmd?.GraphicSheet?.MusicPages;
    if (!pages?.length) return null;
    const notes = [];
    const systems = [];
    for (const page of pages) {
      for (const system of page.MusicSystems || []) {
        const measuresByStart = new Map();
        let top = Infinity;
        let bottom = -Infinity;
        let left = Infinity;
        let right = -Infinity;
        const systemNotes = [];
        for (const line of system.StaffLines || []) {
          const lineBox = shapeBounds(line.PositionAndShape);
          if (lineBox) {
            top = Math.min(top, lineBox.top);
            bottom = Math.max(bottom, lineBox.bottom);
            left = Math.min(left, lineBox.left);
            right = Math.max(right, lineBox.right);
          }
          for (const measure of line.Measures || []) {
            const source = measure.parentSourceMeasure;
            const startWhole = Number(source?.AbsoluteTimestamp?.RealValue);
            const durationWhole = Number(source?.Duration?.RealValue);
            if (!Number.isFinite(startWhole)) continue;
            const box = shapeBounds(measure.PositionAndShape);
            if (!box) continue;
            const startBeat = startWhole * 4;
            const endBeat = startBeat + (Number.isFinite(durationWhole) ? durationWhole * 4 : 0);
            const key = startWhole.toFixed(6);
            let record = measuresByStart.get(key);
            if (!record) {
              record = {
                left: box.left,
                right: box.right,
                startBeat,
                endBeat,
                beatUnit: beatUnitFor(startBeat),
                anchors: []
              };
              measuresByStart.set(key, record);
            } else {
              record.left = Math.min(record.left, box.left);
              record.right = Math.max(record.right, box.right);
              record.endBeat = Math.max(record.endBeat, endBeat);
            }
            top = Math.min(top, box.top);
            bottom = Math.max(bottom, box.bottom);
            for (const entry of measure.staffEntries || []) {
              const beat = wholeToBeats(entry.getAbsoluteTimestamp?.());
              const entryX = Number(entry.PositionAndShape?.AbsolutePosition?.x);
              if (Number.isFinite(beat) && Number.isFinite(entryX)) {
                const anchor = record.anchors.find(item => Math.abs(item.beat - beat) < 0.0001);
                if (anchor) anchor.x = Math.min(anchor.x, entryX);
                else record.anchors.push({ x: entryX, beat });
              }
              for (const voice of entry.graphicalVoiceEntries || []) {
                for (const note of voice.notes || []) {
                  const noteBox = shapeBounds(note.PositionAndShape);
                  if (!noteBox || !Number.isFinite(beat)) continue;
                  const hit = {
                    x: (noteBox.left + noteBox.right) / 2,
                    y: (noteBox.top + noteBox.bottom) / 2,
                    beat
                  };
                  systemNotes.push(hit);
                  notes.push(hit);
                }
              }
            }
          }
        }
        systemNotes.forEach(note => {
          top = Math.min(top, note.y);
          bottom = Math.max(bottom, note.y);
        });
        const measures = [...measuresByStart.values()].sort(
          (a, b) => a.left - b.left || a.startBeat - b.startBeat
        );
        measures.forEach(measure => {
          measure.anchors = measure.anchors
            .filter(anchor => anchor.x >= measure.left - 2 && anchor.x <= measure.right + 2)
            .sort((a, b) => a.x - b.x || a.beat - b.beat);
        });
        if (!measures.length || !Number.isFinite(top) || !Number.isFinite(left)) continue;
        systems.push({ top, bottom, left, right, measures });
      }
    }
    if (!systems.length) return null;
    return {
      notes,
      systems,
      noteRadius: SHEET_NOTE_RADIUS,
      systemSlack: SHEET_SYSTEM_SLACK
    };
  }

  function clampUnit(value) {
    return Math.min(1, Math.max(0, value));
  }

  // A notehead hit is exact. Empty staff space uses the horizontal position
  // between engraved onsets, then snaps to the bar's beat grid unless a note
  // onset is closer (tuplets and other off-grid rhythms).
  function snapRawBeat(raw, measure) {
    const unit = measure.beatUnit > 0 ? measure.beatUnit : 1;
    const span = measure.endBeat - measure.startBeat;
    if (!(span > 0)) return measure.startBeat;
    const maxStep = Math.max(0, Math.round(span / unit));
    const steps = Math.max(0, Math.min(maxStep, Math.round((raw - measure.startBeat) / unit)));
    const grid = measure.startBeat + steps * unit;
    let best = grid;
    let bestDist = Math.abs(grid - raw);
    for (const anchor of measure.anchors || []) {
      const dist = Math.abs(anchor.beat - raw);
      if (dist < bestDist - 1e-6) {
        best = anchor.beat;
        bestDist = dist;
      }
    }
    return best;
  }

  function beatInMeasure(x, measure) {
    const anchors = (measure.anchors || []).filter(
      anchor => Number.isFinite(anchor.x) && Number.isFinite(anchor.beat)
    );
    if (!anchors.length) {
      const width = measure.right - measure.left;
      if (!(width > 0)) return measure.startBeat;
      const fraction = clampUnit((x - measure.left) / width);
      return snapRawBeat(
        measure.startBeat + fraction * (measure.endBeat - measure.startBeat),
        measure
      );
    }
    if (x <= anchors[0].x) return anchors[0].beat;
    const points = anchors.slice();
    const last = points[points.length - 1];
    if (Number.isFinite(measure.right) && measure.right > last.x + 0.05) {
      points.push({ x: measure.right, beat: measure.endBeat });
    }
    if (x >= points[points.length - 1].x) return points[points.length - 1].beat;
    for (let index = 0; index < points.length - 1; index += 1) {
      const left = points[index];
      const right = points[index + 1];
      if (x > right.x) continue;
      const span = right.x - left.x;
      const fraction = span > 0 ? clampUnit((x - left.x) / span) : 0;
      return snapRawBeat(left.beat + fraction * (right.beat - left.beat), measure);
    }
    return points[points.length - 1].beat;
  }

  function beatForSheetClick(point, model) {
    if (!point || !model || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const radius = Number.isFinite(model.noteRadius) ? model.noteRadius : SHEET_NOTE_RADIUS;
    let bestNote = null;
    let bestDist = radius;
    for (const note of model.notes || []) {
      if (!Number.isFinite(note.x) || !Number.isFinite(note.y) || !Number.isFinite(note.beat))
        continue;
      const dist = Math.hypot(note.x - point.x, note.y - point.y);
      if (dist <= radius && dist <= bestDist) {
        bestDist = dist;
        bestNote = note;
      }
    }
    if (bestNote) return bestNote.beat;

    const slack = Number.isFinite(model.systemSlack) ? model.systemSlack : SHEET_SYSTEM_SLACK;
    let system = null;
    let systemDist = Infinity;
    for (const candidate of model.systems || []) {
      const dist =
        point.y < candidate.top
          ? candidate.top - point.y
          : point.y > candidate.bottom
            ? point.y - candidate.bottom
            : 0;
      if (dist < systemDist) {
        systemDist = dist;
        system = candidate;
      }
    }
    if (!system || systemDist > slack) return null;

    const measures = system.measures || [];
    if (!measures.length) return null;
    let measure = null;
    for (const candidate of measures) {
      if (point.x >= candidate.left && point.x < candidate.right) {
        measure = candidate;
        break;
      }
    }
    if (!measure) {
      const first = measures[0];
      const last = measures[measures.length - 1];
      if (point.x < first.left) {
        if (point.x < system.left - 1) return null;
        measure = first;
      } else if (point.x >= last.right) {
        if (point.x > system.right + 1) return null;
        measure = last;
      } else {
        let gap = Infinity;
        for (const candidate of measures) {
          const dist =
            point.x < candidate.left ? candidate.left - point.x : point.x - candidate.right;
          if (dist < gap) {
            gap = dist;
            measure = candidate;
          }
        }
      }
    }
    if (!measure) return null;
    return beatInMeasure(point.x, measure);
  }

  async function renderScore() {
    const piece = state.piece;
    const container = els.osmdContainer;
    const token = (state.renderToken += 1);
    state.cursorBeats = [];
    state.cursorIndex = 0;
    state.scoreLabels = [];
    if (!piece || !container) return;
    const Osmd = window.opensheetmusicdisplay?.OpenSheetMusicDisplay;
    const xml = ensureMusicXml(piece);
    if (!Osmd || !xml) {
      setRenderNote('Score engraving is unavailable in this browser.');
      return;
    }
    if (!state.osmd) {
      state.osmd = new Osmd(container, osmdOptions(state.view === 'fingering'));
    } else if (typeof state.osmd.setOptions === 'function') {
      state.osmd.setOptions({
        drawFingerings: state.view === 'fingering',
        fingeringPosition: 'above',
        autoBeam: true
      });
    }
    // OSMD only applies drawFingerings when the value is false, so the on-state
    // has to be written onto the engraving rules directly.
    if (state.osmd.EngravingRules) {
      state.osmd.EngravingRules.RenderFingerings = state.view === 'fingering';
    }
    setRenderNote('Engraving score…');
    try {
      await state.osmd.load(xml);
      if (token !== state.renderToken) return;
      state.osmd.render();
      if (token !== state.renderToken) return;
      state.osmd.cursor?.show();
      indexScoreCursor();
      syncScoreCursor(state.beat);
      setRenderNote(
        'Engraved with OpenSheetMusicDisplay. Click or tap the score to play from that spot. Note names and generated fingerings sit on the engraved score. Falling notes use the same timing.'
      );
    } catch (error) {
      console.error(error);
      if (token === state.renderToken) {
        setRenderNote(error?.message || 'Could not engrave this score.');
      }
    }
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

  const piano = {
    status: 'idle',
    buffers: new Map(),
    master: null,
    wet: null,
    loadPromise: null
  };

  function toneMode() {
    return els.toneSelect?.value === 'synth' ? 'synth' : 'piano';
  }

  function volumeLevel() {
    const raw = Number(els.volume?.value);
    if (!Number.isFinite(raw)) return 0.8;
    return Math.max(0, Math.min(1, raw / 100));
  }

  function reverbEnabled() {
    return Boolean(els.reverbToggle?.checked);
  }

  function updateSoundStatus() {
    if (!els.soundStatus) return;
    if (toneMode() !== 'piano') {
      els.soundStatus.textContent = '';
      return;
    }
    if (piano.status === 'loading') els.soundStatus.textContent = 'Loading piano…';
    else if (piano.status === 'failed') els.soundStatus.textContent = 'Synth fallback';
    else els.soundStatus.textContent = '';
  }

  function rampParam(param, value, when, seconds) {
    const level = Math.max(0, value);
    if (!param.setValueAtTime || !param.linearRampToValueAtTime) {
      param.value = level;
      return;
    }
    const now = Math.max(when, 0);
    param.cancelScheduledValues?.(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(level, now + seconds);
  }

  function makeImpulse(audio) {
    if (typeof audio.createBuffer !== 'function') return null;
    const rate = audio.sampleRate || 44100;
    const length = Math.floor(rate * 1.1);
    const buffer = audio.createBuffer(2, length, rate);
    if (!buffer || typeof buffer.getChannelData !== 'function') return null;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        const decay = (1 - index / data.length) ** 2.6;
        data[index] = (Math.random() * 2 - 1) * decay * 0.35;
      }
    }
    return buffer;
  }

  function ensureOutput(audio) {
    if (piano.master) return piano.master;
    const master = audio.createGain();
    master.gain.value = volumeLevel();
    let tail = master;
    const compressor =
      typeof audio.createDynamicsCompressor === 'function'
        ? audio.createDynamicsCompressor()
        : null;
    if (compressor?.threshold && compressor.knee && compressor.ratio) {
      compressor.threshold.value = -16;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      if (compressor.attack) compressor.attack.value = 0.004;
      if (compressor.release) compressor.release.value = 0.22;
      tail.connect(compressor);
      tail = compressor;
    }
    tail.connect(audio.destination);
    if (typeof audio.createConvolver === 'function') {
      const impulse = makeImpulse(audio);
      if (impulse) {
        const wet = audio.createGain();
        wet.gain.value = reverbEnabled() ? 0.16 : 0;
        const convolver = audio.createConvolver();
        convolver.buffer = impulse;
        tail.connect(wet);
        wet.connect(convolver);
        convolver.connect(audio.destination);
        piano.wet = wet;
      }
    }
    piano.master = master;
    return master;
  }

  function outputNode(audio) {
    try {
      return ensureOutput(audio);
    } catch (error) {
      console.warn('Could not build the audio output', error);
      return audio.destination;
    }
  }

  function applyVolume() {
    if (!piano.master) return;
    const now = state.audioContext ? state.audioContext.currentTime : 0;
    rampParam(piano.master.gain, volumeLevel(), now, 0.03);
  }

  function applyReverb() {
    if (!piano.wet) return;
    const now = state.audioContext ? state.audioContext.currentTime : 0;
    rampParam(piano.wet.gain, reverbEnabled() ? 0.16 : 0, now, 0.05);
  }

  function decodeAudioData(audio, bytes) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, buffer) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(buffer);
      };
      try {
        const pending = audio.decodeAudioData(
          bytes.slice(0),
          buffer => finish(null, buffer),
          error => finish(error || new Error('Could not decode a piano sample'))
        );
        if (pending && typeof pending.then === 'function')
          pending.then(
            buffer => finish(null, buffer),
            error => finish(error)
          );
      } catch (error) {
        finish(error);
      }
    });
  }

  function sampleRequestUrl(name) {
    const relative = window.PianoSamples.sampleUrl(name);
    return new URL(relative, document.baseURI).href;
  }

  async function loadSample(audio, name) {
    const response = await fetch(sampleRequestUrl(name));
    if (!response.ok) throw new Error(`Piano sample failed to load (${response.status})`);
    const bytes = await response.arrayBuffer();
    const buffer = await decodeAudioData(audio, bytes);
    piano.buffers.set(name, buffer);
  }

  function ensureSamples() {
    if (piano.status === 'ready' || piano.status === 'loading') return piano.loadPromise;
    if (piano.status === 'failed') return Promise.resolve();
    const audio = state.audioContext;
    if (
      !window.PianoSamples ||
      !audio ||
      typeof audio.decodeAudioData !== 'function' ||
      typeof fetch !== 'function'
    ) {
      piano.status = 'failed';
      updateSoundStatus();
      return Promise.resolve();
    }
    piano.status = 'loading';
    updateSoundStatus();
    const names = window.PianoSamples.SAMPLE_MIDIS.map(midi =>
      window.PianoSamples.sampleName(midi)
    );
    piano.loadPromise = Promise.all(names.map(name => loadSample(audio, name)))
      .then(() => {
        piano.status = 'ready';
        updateSoundStatus();
      })
      .catch(error => {
        console.warn('Piano samples failed to load', error);
        piano.buffers.clear();
        piano.status = 'failed';
        updateSoundStatus();
      });
    return piano.loadPromise;
  }

  function retrySamples() {
    piano.status = 'idle';
    piano.buffers.clear();
    piano.loadPromise = null;
    if (state.audioContext) ensureSamples();
    else updateSoundStatus();
  }

  function ensureAudioContext() {
    if (!state.audioContext) {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioContext.state === 'suspended') state.audioContext.resume();
    return state.audioContext;
  }

  function stopVoice(item, now) {
    const release = item.source ? 0.42 : 0.04;
    item.gain.gain.cancelScheduledValues(now);
    item.gain.gain.setValueAtTime(Math.max(item.gain.gain.value, 0.0001), now);
    item.gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
    (item.source || item.oscillator).stop(now + release + 0.02);
  }

  function stopSounding() {
    const audio = state.audioContext;
    const now = audio ? audio.currentTime : 0;
    state.scheduled.forEach(item => {
      try {
        stopVoice(item, now);
      } catch (error) {
        console.warn('Could not stop a scheduled note', error);
      }
    });
    state.scheduled = [];
  }

  function damperRelease(midi) {
    const span = Math.max(0, Math.min(1, (midi - 21) / (108 - 21)));
    return 0.7 - span * 0.42;
  }

  function scheduleSynth(note, frequency, startAt, duration, audio) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    const peak = note.hand === 'right' ? 0.12 : 0.09;
    gain.gain.value = 0.0001;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(outputNode(audio));
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
    state.scheduled.push({ oscillator, gain, when: startAt });
  }

  function scheduleSample(note, midi, startAt, duration, audio) {
    const mapped = window.PianoSamples.nearestSample(midi);
    const buffer = mapped && piano.buffers.get(mapped.name);
    if (!buffer || typeof audio.createBufferSource !== 'function') return false;
    const velocity = window.PianoSamples.velocityGain(note);
    const peak = 0.28 * velocity * (note.hand === 'left' ? 0.92 : 1);
    if (!(peak > 0.0001)) return true;
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = buffer;
    const rate = mapped.playbackRate;
    if (source.playbackRate?.setValueAtTime) source.playbackRate.setValueAtTime(rate, startAt);
    else source.playbackRate.value = rate;
    gain.gain.value = 0.0001;
    const attack = 0.01;
    const sustainAt = Math.max(attack + 0.01, duration);
    const release = damperRelease(midi);
    const held = Math.max(peak * 0.55, 0.0001);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + attack);
    gain.gain.exponentialRampToValueAtTime(held, startAt + sustainAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + sustainAt + release);
    source.connect(gain);
    gain.connect(outputNode(audio));
    source.start(startAt);
    source.stop(startAt + sustainAt + release + 0.02);
    state.scheduled.push({ source, gain, release, when: startAt });
    return true;
  }

  function playPitch(pitch, seconds = 0.6) {
    const durationSeconds = Number(seconds);
    if (!pitch || !(durationSeconds > 0)) return;
    try {
      const audio = ensureAudioContext();
      const beats = (durationSeconds * state.tempo) / 60;
      scheduleTone({ pitch, duration: beats, hand: 'right' }, audio.currentTime, beats);
    } catch (error) {
      console.warn('Could not play a practice note', error);
    }
  }

  function scheduleTone(note, when, durationBeats = note.duration) {
    if (!els.soundToggle.checked || !(durationBeats > 0.02)) return;
    const audio = ensureAudioContext();
    const startAt = Math.max(when, audio.currentTime);
    let midi = null;
    try {
      midi = pitchToMidi(note.pitch);
    } catch (error) {
      console.warn('Skipping invalid audio pitch', note.pitch, error);
      return;
    }
    if (!Number.isFinite(midi)) return;
    if (toneMode() === 'piano' && piano.status === 'idle') ensureSamples();
    if (toneMode() === 'piano' && piano.status === 'ready') {
      const duration = Math.max(0.08, secondsForBeats(durationBeats));
      try {
        if (scheduleSample(note, midi, startAt, duration, audio)) return;
      } catch (error) {
        console.warn('Falling back to the synth for', note.pitch, error);
      }
    }
    const duration = Math.max(0.08, secondsForBeats(durationBeats) * 0.88);
    scheduleSynth(note, frequencyForPitch(note.pitch), startAt, duration, audio);
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

  function clampPlayableBeat(beat) {
    const limit = totalBeats();
    if (!(limit > 0)) return 0;
    const target = Math.max(0, Math.min(limit, beat));
    if (target < limit - 1e-6) return target;
    const unit = beatUnitFor(Math.max(0, limit - 1e-3));
    const step = Math.min(limit, unit > 0 ? unit : 1);
    return Math.max(0, limit - step);
  }

  function beginPlayback() {
    state.playing = true;
    anchorClock(state.beat);
    armScheduler(state.beat);
    ensureScheduler();
    updatePlayButton();
  }

  function playFromBeat(beat) {
    if (!Number.isFinite(beat)) return;
    const target = clampPlayableBeat(beat);
    if (state.playing) {
      seekTo(target, { keepPlaying: true });
      return;
    }
    seekTo(target, { keepPlaying: false });
    beginPlayback();
  }

  function play() {
    if (state.beat >= totalBeats() - 0.001) state.beat = 0;
    beginPlayback();
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
    syncScoreCursor(state.beat);
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

  function scoreNeedsLayout() {
    const svg = els.osmdContainer?.querySelector('svg');
    if (!svg) return true;
    return svg.getBoundingClientRect().width < 20;
  }

  function setView(view) {
    const previous = state.view;
    state.view = view;
    els.tabs.forEach(tab => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    const falling = view === 'falling';
    const reading = view === 'reading';
    els.scorePanel.classList.toggle('is-hidden', falling || reading);
    els.fallingPanel.classList.toggle('is-hidden', !falling);
    els.readingPanel?.classList.toggle('is-hidden', !reading);
    document.body.classList.toggle('is-reading', reading);
    els.tabs
      .find(tab => tab.dataset.view === view)
      ?.scrollIntoView?.({
        inline: 'nearest',
        block: 'nearest'
      });
    if (reading) {
      if (state.playing) pause();
      window.NoteReading?.onShow();
      return;
    }
    window.NoteReading?.onHide();
    if (falling) {
      requestFallingRedraw();
      requestAnimationFrame(() => requestFallingRedraw());
    } else if (
      (previous === 'fingering') !== (view === 'fingering') ||
      !state.osmd ||
      scoreNeedsLayout()
    ) {
      renderScore();
    } else {
      updateScoreAnnotations();
      syncScoreCursor(state.beat);
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

  let scorePointer = null;
  let lastSheetSeekAt = 0;

  function playFromSheetClient(clientX, clientY) {
    const now = Date.now();
    if (now - lastSheetSeekAt < 50) return;
    const sheet = state.osmd?.GraphicSheet;
    if (!sheet || typeof sheet.domToSvg !== 'function' || typeof sheet.svgToOsmd !== 'function')
      return;
    let svgPoint;
    try {
      svgPoint = sheet.domToSvg({ x: clientX, y: clientY });
    } catch (error) {
      console.error(error);
      return;
    }
    const point = sheet.svgToOsmd(svgPoint);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    let beat = null;
    try {
      beat = beatForSheetClick(point, readSheetHitModel());
    } catch (error) {
      console.error(error);
      return;
    }
    if (!Number.isFinite(beat)) return;
    lastSheetSeekAt = now;
    playFromBeat(beat);
  }

  function onScorePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const tag = event.target?.tagName;
    if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT') return;
    scorePointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function onScorePointerUp(event) {
    const start = scorePointer;
    if (!start || start.id !== event.pointerId) return;
    scorePointer = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dx * dx + dy * dy > 100) return;
    playFromSheetClient(event.clientX, event.clientY);
  }

  if (els.scoreStage) {
    els.scoreStage.addEventListener('pointerdown', onScorePointerDown);
    els.scoreStage.addEventListener('click', event => {
      if (event.button !== 0) return;
      playFromSheetClient(event.clientX, event.clientY);
    });
  }
  window.addEventListener('pointerup', onScorePointerUp);
  window.addEventListener('pointercancel', () => {
    scorePointer = null;
  });

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

  els.toneSelect?.addEventListener('change', () => {
    if (toneMode() === 'piano' && piano.status === 'failed') retrySamples();
    updateSoundStatus();
    if (!state.playing) return;
    const beat = beatNow();
    state.beat = beat;
    stopSounding();
    anchorClock(beat);
    armScheduler(beat);
  });

  els.volume?.addEventListener('input', applyVolume);
  els.reverbToggle?.addEventListener('change', applyReverb);

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
    beatForSheetClick,
    playFromBeat,
    playPitch,
    getState: () => ({
      piece: state.piece,
      view: state.view,
      beat: state.beat,
      tempo: state.tempo,
      playing: state.playing
    })
  };
})();
