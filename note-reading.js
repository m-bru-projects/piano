(() => {
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const SOLFEGE_SHARP = [
    'Do',
    'Do♯',
    'Re',
    'Re♯',
    'Mi',
    'Fa',
    'Fa♯',
    'Sol',
    'Sol♯',
    'La',
    'La♯',
    'Si'
  ];
  const SOLFEGE_FLAT = [
    'Do',
    'Re♭',
    'Re',
    'Mi♭',
    'Mi',
    'Fa',
    'Sol♭',
    'Sol',
    'La♭',
    'La',
    'Si♭',
    'Si'
  ];
  const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);
  const KEY_OFFSETS = {
    KeyZ: 0,
    KeyS: 1,
    KeyX: 2,
    KeyD: 3,
    KeyC: 4,
    KeyV: 5,
    KeyG: 6,
    KeyB: 7,
    KeyH: 8,
    KeyN: 9,
    KeyJ: 10,
    KeyM: 11,
    KeyQ: 12,
    Digit2: 13,
    KeyW: 14,
    Digit3: 15,
    KeyE: 16,
    KeyR: 17,
    Digit5: 18,
    KeyT: 19,
    Digit6: 20,
    KeyY: 21,
    Digit7: 22,
    KeyU: 23,
    KeyI: 24
  };

  const KEYS = [
    { id: 'C', label: 'C major', fifths: 0, mode: 'major' },
    { id: 'G', label: 'G major', fifths: 1, mode: 'major' },
    { id: 'D', label: 'D major', fifths: 2, mode: 'major' },
    { id: 'F', label: 'F major', fifths: -1, mode: 'major' },
    { id: 'Bb', label: 'Bb major', fifths: -2, mode: 'major' },
    { id: 'Am', label: 'A minor', fifths: 0, mode: 'minor' },
    { id: 'Em', label: 'E minor', fifths: 1, mode: 'minor' },
    { id: 'Dm', label: 'D minor', fifths: -1, mode: 'minor' }
  ];

  const RANGES = {
    beginner: {
      label: 'Beginner · middle C ± a fifth',
      treble: [60, 67],
      bass: [53, 60],
      both: [53, 67]
    },
    ledger: {
      label: 'With ledger lines',
      treble: [57, 81],
      bass: [40, 64],
      both: [40, 81]
    },
    full: {
      label: 'Full range',
      treble: [55, 84],
      bass: [36, 65],
      both: [36, 84]
    }
  };

  const CLEFS = new Set(['treble', 'bass', 'both']);
  const NAMINGS = new Set(['letters', 'solfege']);
  const STORAGE_SETTINGS = 'piano-note-reading-settings';
  const STORAGE_PROGRESS = 'piano-note-reading-progress';
  const CORRECT_DELAY = 1200;
  const WRONG_DELAY = 1900;
  const GROUP_CORRECT_DELAY = 450;

  function defaultSettings() {
    return {
      clef: 'treble',
      range: 'beginner',
      accidentals: false,
      key: 'C',
      naming: 'letters',
      group: 1
    };
  }

  function keyById(id) {
    return KEYS.find(key => key.id === id) || KEYS[0];
  }

  function sanitizeSettings(value) {
    const defaults = defaultSettings();
    const source = value && typeof value === 'object' ? value : {};
    const group = Number(source.group);
    return {
      clef: CLEFS.has(source.clef) ? source.clef : defaults.clef,
      range: RANGES[source.range] ? source.range : defaults.range,
      accidentals: source.accidentals === true,
      key: keyById(source.key).id,
      naming: NAMINGS.has(source.naming) ? source.naming : defaults.naming,
      group: group >= 1 && group <= 3 ? Math.round(group) : defaults.group
    };
  }

  function pitchClass(midi) {
    return ((midi % 12) + 12) % 12;
  }

  function usesFlats(key) {
    return key.fifths < 0;
  }

  function tonicPitchClass(key) {
    const major = (((key.fifths * 7) % 12) + 12) % 12;
    return key.mode === 'minor' ? (major + 9) % 12 : major;
  }

  function diatonicSet(key) {
    const tonic = tonicPitchClass(key);
    const steps = key.mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    return new Set(steps.map(step => (tonic + step) % 12));
  }

  function diatonicPitchClasses(keyOrId) {
    const key = typeof keyOrId === 'string' ? keyById(keyOrId) : keyById(keyOrId?.id);
    return [...diatonicSet(key)].sort((left, right) => left - right);
  }

  function spell(midi, key) {
    const pc = pitchClass(midi);
    const names = usesFlats(key) ? FLAT_NAMES : SHARP_NAMES;
    const spelling = names[pc];
    const match = /^([A-G])([#b]?)$/.exec(spelling);
    const octave = Math.floor(midi / 12) - 1;
    return {
      midi,
      pc,
      letter: match[1],
      accidental: match[2],
      octave,
      spelling,
      pitch: `${spelling}${octave}`
    };
  }

  function formatPitch(note, naming) {
    if (naming === 'solfege') {
      const table = note.accidental === 'b' ? SOLFEGE_FLAT : SOLFEGE_SHARP;
      return `${table[note.pc]} ${note.octave}`;
    }
    return `${note.spelling.replace('#', '♯').replace('b', '♭')}${note.octave}`;
  }

  function formatClass(note, naming) {
    return formatPitch(note, naming).replace(/ ?-?\d+$/, '');
  }

  function rangeFor(settings) {
    const preset = RANGES[settings.range] || RANGES.beginner;
    const span = preset[settings.clef] || preset.both;
    return { min: span[0], max: span[1] };
  }

  function candidates(settings) {
    const { min, max } = rangeFor(settings);
    const key = keyById(settings.key);
    const diatonic = settings.accidentals ? null : diatonicSet(key);
    const notes = [];
    for (let midi = min; midi <= max; midi += 1) {
      if (diatonic && !diatonic.has(pitchClass(midi))) continue;
      notes.push(spell(midi, key));
    }
    return notes;
  }

  function signatureNotesPresent(settings) {
    const key = keyById(settings.key);
    if (!key.fifths) return true;
    const diatonic = diatonicSet(key);
    return candidates(settings).some(note => note.accidental && diatonic.has(note.pc));
  }

  function weightFor(note, memory, recent) {
    const record = memory?.[note.midi];
    let value;
    if (!record || !record.seen) value = 1.35;
    else {
      const missRate = record.wrong / record.seen;
      value = 1 + missRate * 4 + record.wrong * 0.35 - Math.min(record.streak || 0, 4) * 0.3;
    }
    if (recent?.includes(note.midi)) value *= 0.15;
    return Math.max(0.05, value);
  }

  function pickNotes(pool, count, memory, recent, random = Math.random) {
    const chosen = [];
    const available = pool.slice();
    const recentLocal = recent.slice();
    const target = Math.max(0, count);
    while (chosen.length < target && available.length) {
      const weights = available.map(note => weightFor(note, memory, recentLocal));
      const total = weights.reduce((sum, value) => sum + value, 0);
      let cursor = random() * total;
      let index = 0;
      for (; index < available.length - 1; index += 1) {
        cursor -= weights[index];
        if (cursor <= 0) break;
      }
      const [note] = available.splice(index, 1);
      chosen.push(note);
      recentLocal.push(note.midi);
    }
    return chosen;
  }

  function clefForMidi(midi, clef) {
    if (clef === 'bass') return 'bass';
    if (clef === 'treble') return 'treble';
    return midi >= 60 ? 'treble' : 'bass';
  }

  function pickPrompt(settings, memory, recent, random = Math.random) {
    const pool = candidates(settings);
    if (!pool.length) {
      return { notes: [], staff: settings.clef === 'bass' ? 'bass' : 'treble' };
    }
    const count = Math.max(1, Math.min(3, Number(settings.group) || 1));
    const [first] = pickNotes(pool, 1, memory, recent, random);
    const staff = clefForMidi(first.midi, settings.clef);
    const notes = [first];
    if (count > 1) {
      const sameStaff = pool.filter(
        note => note.midi !== first.midi && clefForMidi(note.midi, settings.clef) === staff
      );
      notes.push(...pickNotes(sameStaff, count - 1, memory, recent.concat(first.midi), random));
    }
    return { notes, staff };
  }

  function keyboardBounds(min, max) {
    const loPc = pitchClass(min);
    const hiPc = pitchClass(max);
    return [min - loPc, hiPc === 0 ? max : max + (12 - hiPc)];
  }

  function baseMidi(min, max) {
    const [lo, hi] = keyboardBounds(min, max);
    if (hi - lo <= 24) return lo;
    let base = Math.round((min + max) / 2) - 12;
    base -= pitchClass(base);
    if (base < lo) base = lo;
    if (base + 24 > hi) {
      const fitted = hi - 24;
      base = fitted - pitchClass(fitted);
    }
    if (base < lo) base = lo;
    return base;
  }

  function midiForCode(code, base) {
    if (!Object.prototype.hasOwnProperty.call(KEY_OFFSETS, code)) return null;
    return base + KEY_OFFSETS[code];
  }

  function midiMessageNote(data) {
    if (!data || data.length < 3) return null;
    const command = data[0] & 0xf0;
    if (command === 0x90 && data[2] > 0) return data[1];
    return null;
  }

  function pointsFor(correct, streakBefore) {
    if (!correct) return 0;
    return 10 + Math.min(Math.max(0, streakBefore), 10) * 2;
  }

  function emptyRecord() {
    return { seen: 0, wrong: 0, correct: 0, streak: 0 };
  }

  function recordAnswer(memory, midi, correct) {
    const prev = memory?.[midi] || emptyRecord();
    return {
      ...memory,
      [midi]: {
        seen: prev.seen + 1,
        wrong: prev.wrong + (correct ? 0 : 1),
        correct: prev.correct + (correct ? 1 : 0),
        streak: correct ? prev.streak + 1 : 0
      }
    };
  }

  function createSession(memory = {}) {
    return {
      attempts: [],
      streak: 0,
      points: 0,
      memory,
      recent: [],
      prompt: null,
      index: 0,
      noteStartedAt: 0,
      locked: false,
      last: null
    };
  }

  function beginPrompt(session, prompt, now) {
    return {
      ...session,
      prompt,
      index: 0,
      noteStartedAt: now,
      locked: false,
      last: null
    };
  }

  function arm(session, now) {
    return { ...session, noteStartedAt: now, locked: false };
  }

  function answerPrompt(session, input, now) {
    const notes = session.prompt?.notes || [];
    const expected = notes[session.index];
    if (!expected) return session;
    const byName = Boolean(input.byName);
    const skip = Boolean(input.skip);
    const correct = !skip && (byName ? input.pc === expected.pc : input.midi === expected.midi);
    const ms = Math.max(0, now - (session.noteStartedAt || now));
    const gained = pointsFor(correct, session.streak);
    const nextIndex = session.index + 1;
    return {
      ...session,
      attempts: session.attempts.concat({
        midi: expected.midi,
        correct,
        ms,
        points: gained,
        byName,
        skip,
        playedMidi: byName || skip ? null : input.midi
      }),
      streak: correct ? session.streak + 1 : 0,
      points: session.points + gained,
      memory: recordAnswer(session.memory, expected.midi, correct),
      recent: session.recent.concat(expected.midi).slice(-8),
      index: nextIndex,
      last: {
        correct,
        expected,
        playedMidi: byName || skip ? null : input.midi,
        byName,
        skip,
        done: nextIndex >= notes.length,
        gained
      }
    };
  }

  function summarize(attempts) {
    const list = attempts || [];
    const answered = list.length;
    const correct = list.filter(item => item.correct).length;
    const times = list.filter(item => !item.skip && item.ms >= 0).map(item => item.ms);
    const averageMs = times.length
      ? times.reduce((sum, value) => sum + value, 0) / times.length
      : 0;
    let bestStreak = 0;
    let run = 0;
    list.forEach(item => {
      run = item.correct ? run + 1 : 0;
      if (run > bestStreak) bestStreak = run;
    });
    let streak = 0;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (!list[index].correct) break;
      streak += 1;
    }
    const points = list.reduce((sum, item) => sum + (item.points || 0), 0);
    return {
      answered,
      correct,
      accuracy: answered ? correct / answered : 0,
      averageMs,
      bestStreak,
      streak,
      points
    };
  }

  function formatReaction(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '–';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  }

  function formatAccuracy(ratio, answered) {
    if (!answered) return '–';
    return `${Math.round(ratio * 100)}%`;
  }

  function formatClock(ms) {
    const safe = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(safe / 60);
    const seconds = Math.floor(safe % 60)
      .toString()
      .padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function clampCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return Math.min(100000, Math.round(number));
  }

  function normalizeMemory(memory) {
    const next = {};
    if (!memory || typeof memory !== 'object') return next;
    Object.entries(memory).forEach(([key, value]) => {
      const midi = Number(key);
      if (!Number.isInteger(midi) || midi < 0 || midi > 127 || !value || typeof value !== 'object')
        return;
      next[midi] = {
        seen: clampCount(value.seen),
        wrong: clampCount(value.wrong),
        correct: clampCount(value.correct),
        streak: clampCount(value.streak)
      };
    });
    return next;
  }

  function storage() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function loadSettings() {
    try {
      const raw = storage()?.getItem(STORAGE_SETTINGS);
      if (!raw) return defaultSettings();
      return sanitizeSettings(JSON.parse(raw));
    } catch (error) {
      return defaultSettings();
    }
  }

  function saveSettings(settings) {
    try {
      storage()?.setItem(STORAGE_SETTINGS, JSON.stringify(sanitizeSettings(settings)));
    } catch (error) {
      console.warn('Could not save note-reading settings', error);
    }
  }

  function emptyProgress() {
    return { bestStreak: 0, bestTimed: 0, memory: {} };
  }

  function loadProgress() {
    try {
      const raw = storage()?.getItem(STORAGE_PROGRESS);
      if (!raw) return emptyProgress();
      const parsed = JSON.parse(raw);
      return {
        bestStreak: clampCount(parsed?.bestStreak),
        bestTimed: clampCount(parsed?.bestTimed),
        memory: normalizeMemory(parsed?.memory)
      };
    } catch (error) {
      return emptyProgress();
    }
  }

  function saveProgress(progress) {
    try {
      storage()?.setItem(
        STORAGE_PROGRESS,
        JSON.stringify({
          bestStreak: clampCount(progress.bestStreak),
          bestTimed: clampCount(progress.bestTimed),
          memory: normalizeMemory(progress.memory)
        })
      );
    } catch (error) {
      console.warn('Could not save note-reading progress', error);
    }
  }

  function durationPlan(count) {
    if (count <= 1) return [{ dur: 4, type: 'whole' }];
    if (count === 2)
      return [
        { dur: 2, type: 'half' },
        { dur: 2, type: 'half' }
      ];
    return [
      { dur: 1, type: 'quarter' },
      { dur: 1, type: 'quarter' },
      { dur: 1, type: 'quarter' },
      { dur: 1, type: 'quarter', rest: true }
    ];
  }

  function pitchXml(note) {
    const alter =
      note.accidental === '#'
        ? '<alter>1</alter>'
        : note.accidental === 'b'
          ? '<alter>-1</alter>'
          : '';
    return `<pitch><step>${note.letter}</step>${alter}<octave>${note.octave}</octave></pitch>`;
  }

  function noteXml(note, slot, staff) {
    const staffXml = staff ? `<staff>${staff}</staff>` : '';
    if (!note || slot.rest) {
      return `<note><rest/><duration>${slot.dur}</duration><type>${slot.type}</type>${staffXml}</note>`;
    }
    return `<note>${pitchXml(note)}<duration>${slot.dur}</duration><type>${slot.type}</type>${staffXml}</note>`;
  }

  function musicXml(notes, settings) {
    const key = keyById(settings.key);
    const spelled = (notes || []).map(note => spell(note.midi, key));
    const grand = settings.clef === 'both';
    const staff = grand ? (spelled[0] && spelled[0].midi < 60 ? 2 : 1) : 0;
    const slots = durationPlan(Math.max(1, spelled.length));
    const sounding = spelled.length
      ? slots.map((slot, index) => noteXml(spelled[index], slot, staff || null))
      : [noteXml(null, slots[0], staff || null)];
    let body = sounding.join('');
    if (grand) {
      const other = staff === 1 ? 2 : 1;
      body += `<backup><duration>4</duration></backup>${noteXml(null, { dur: 4, type: 'whole', rest: true }, other)}`;
    }
    const clefXml = grand
      ? '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>'
      : settings.clef === 'bass'
        ? '<clef><sign>F</sign><line>4</line></clef>'
        : '<clef><sign>G</sign><line>2</line></clef>';
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        ${clefXml}
      </attributes>
      ${body}
    </measure>
  </part>
</score-partwise>`;
  }

  function hintText(settings) {
    const { min, max } = rangeFor(settings);
    const key = keyById(settings.key);
    const span = `${formatPitch(spell(min, key), 'letters')}–${formatPitch(spell(max, key), 'letters')}`;
    const base = baseMidi(min, max);
    const from = formatPitch(spell(base, key), 'letters');
    const upper = formatPitch(spell(base + 12, key), 'letters');
    const parts = [
      `Range ${span}.`,
      `Computer keys: Z row from ${from}, Q row from ${upper}.`,
      'Name buttons check the letter, not the octave.'
    ];
    if (settings.group > 1) parts.push('Play groups from left to right.');
    if (!signatureNotesPresent(settings)) parts.push('No signature notes fall in this range.');
    return parts.join(' ');
  }

  const api = {
    RANGES,
    KEYS,
    KEY_OFFSETS,
    STORAGE_SETTINGS,
    STORAGE_PROGRESS,
    CORRECT_DELAY,
    WRONG_DELAY,
    defaultSettings,
    sanitizeSettings,
    keyById,
    spell,
    formatPitch,
    formatClass,
    diatonicPitchClasses,
    rangeFor,
    candidates,
    signatureNotesPresent,
    weightFor,
    pickNotes,
    pickPrompt,
    clefForMidi,
    keyboardBounds,
    baseMidi,
    midiForCode,
    midiMessageNote,
    pointsFor,
    recordAnswer,
    createSession,
    beginPrompt,
    arm,
    answerPrompt,
    summarize,
    formatReaction,
    formatAccuracy,
    formatClock,
    loadSettings,
    saveSettings,
    loadProgress,
    saveProgress,
    musicXml,
    hintText
  };

  function mount() {
    const panel = document.getElementById('readingPanel');
    if (!panel) return;

    const els = {
      panel,
      clef: document.getElementById('readingClef'),
      range: document.getElementById('readingRange'),
      key: document.getElementById('readingKey'),
      accidentals: document.getElementById('readingAccidentals'),
      naming: document.getElementById('readingNaming'),
      group: document.getElementById('readingGroup'),
      timed: document.getElementById('readingTimed'),
      reset: document.getElementById('readingReset'),
      skip: document.getElementById('readingSkip'),
      midi: document.getElementById('readingMidi'),
      midiStatus: document.getElementById('readingMidiStatus'),
      points: document.getElementById('readingPoints'),
      streak: document.getElementById('readingStreak'),
      accuracy: document.getElementById('readingAccuracy'),
      reaction: document.getElementById('readingReaction'),
      clock: document.getElementById('readingClock'),
      clockValue: document.getElementById('readingClockValue'),
      best: document.getElementById('readingBest'),
      stage: document.getElementById('readingStage'),
      engrave: document.getElementById('readingEngrave'),
      feedback: document.getElementById('readingFeedback'),
      answer: document.getElementById('readingAnswer'),
      names: document.getElementById('readingNames'),
      hint: document.getElementById('readingHint'),
      keyboard: document.getElementById('readingKeyboard')
    };

    let settings = loadSettings();
    let progress = loadProgress();
    let session = createSession(progress.memory);
    let shown = false;
    let renderToken = 0;
    let osmd = null;
    let advanceTimer = 0;
    let clockTimer = 0;
    let timed = null;
    let finished = false;
    let awaitingEngraving = false;
    let keyboardSignature = '';
    let namesSignature = '';
    KEYS.forEach(key => {
      const option = document.createElement('option');
      option.value = key.id;
      option.textContent = key.label;
      els.key.appendChild(option);
    });

    function now() {
      return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    }

    function applyDom() {
      els.clef.value = settings.clef;
      els.range.value = settings.range;
      els.key.value = settings.key;
      els.accidentals.checked = settings.accidentals;
      els.naming.value = settings.naming;
      els.group.value = String(settings.group);
    }

    function readDom() {
      settings = sanitizeSettings({
        clef: els.clef.value,
        range: els.range.value,
        accidentals: els.accidentals.checked,
        key: els.key.value,
        naming: els.naming.value,
        group: Number(els.group.value)
      });
      saveSettings(settings);
    }

    function currentBounds() {
      const { min, max } = rangeFor(settings);
      return { min, max, base: baseMidi(min, max), bounds: keyboardBounds(min, max) };
    }

    function setFeedback(message, tone) {
      els.feedback.textContent = message;
      els.feedback.classList.toggle('is-correct', tone === 'correct');
      els.feedback.classList.toggle('is-wrong', tone === 'wrong');
      els.stage.classList.toggle('is-correct', tone === 'correct');
      els.stage.classList.toggle('is-wrong', tone === 'wrong');
    }

    function setAnswer(text) {
      els.answer.textContent = text || '';
    }

    function renderStats() {
      const summary = summarize(session.attempts);
      els.points.textContent = String(session.points);
      els.streak.textContent = String(session.streak);
      els.accuracy.textContent = formatAccuracy(summary.accuracy, summary.answered);
      els.reaction.textContent = summary.answered ? formatReaction(summary.averageMs) : '–';
      const bests = [];
      if (progress.bestStreak) bests.push(`Best streak ${progress.bestStreak}`);
      if (progress.bestTimed) bests.push(`Best 60s ${progress.bestTimed}`);
      els.best.textContent = bests.join(' · ');
      const running = Boolean(timed && !timed.paused);
      els.clock.classList.toggle('is-hidden', !timed);
      if (timed) {
        const left = timed.paused ? timed.remaining : Math.max(0, timed.endsAt - now());
        els.clockValue.textContent = formatClock(left);
      }
      els.timed.textContent = running ? 'Stop' : finished ? 'Practice' : '60s drill';
    }

    function promptStatus() {
      const notes = session.prompt?.notes || [];
      if (notes.length > 1 && session.index < notes.length) {
        return `Play note ${session.index + 1} of ${notes.length}`;
      }
      return 'Play this note';
    }

    function clearKeyboardMarks() {
      els.keyboard.querySelectorAll('button').forEach(button => {
        button.classList.remove('is-correct', 'is-wrong', 'is-target', 'is-pressed');
        const label = button.querySelector('.reading-key-label');
        if (label) label.textContent = button.dataset.defaultLabel || '';
      });
    }

    function labelFor(button, text) {
      const label = button.querySelector('.reading-key-label');
      if (label) label.textContent = text;
    }

    function paintKeyboard(last) {
      clearKeyboardMarks();
      if (!last) return;
      const expected = els.keyboard.querySelector(`[data-midi="${last.expected.midi}"]`);
      const key = keyById(settings.key);
      if (expected) {
        expected.classList.add(last.correct ? 'is-correct' : 'is-target');
        labelFor(expected, formatPitch(last.expected, settings.naming));
        const scroller = els.keyboard.parentElement;
        const keyBox = expected.getBoundingClientRect();
        const scrollBox = scroller?.getBoundingClientRect();
        if (scrollBox && (keyBox.left < scrollBox.left + 4 || keyBox.right > scrollBox.right - 4)) {
          expected.scrollIntoView?.({ inline: 'center', block: 'nearest' });
        }
      }
      if (
        !last.correct &&
        Number.isInteger(last.playedMidi) &&
        last.playedMidi !== last.expected.midi
      ) {
        const played = els.keyboard.querySelector(`[data-midi="${last.playedMidi}"]`);
        if (played) {
          played.classList.add('is-wrong');
          labelFor(played, formatPitch(spell(last.playedMidi, key), settings.naming));
        }
      }
    }

    function buildKeyboard(lo, hi) {
      const key = keyById(settings.key);
      const whites = [];
      const blacks = [];
      for (let midi = lo; midi <= hi; midi += 1) {
        if (WHITE_PITCH_CLASSES.has(pitchClass(midi))) whites.push(midi);
        else blacks.push(midi);
      }
      const bed = document.createElement('div');
      bed.className = 'reading-keybed';
      bed.style.setProperty('--white-count', String(Math.max(1, whites.length)));
      whites.forEach(midi => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reading-white';
        button.dataset.midi = String(midi);
        const note = spell(midi, key);
        const defaultLabel = pitchClass(midi) === 0 ? formatPitch(note, 'letters') : '';
        button.dataset.defaultLabel = defaultLabel;
        button.setAttribute('aria-label', formatPitch(note, settings.naming));
        const label = document.createElement('span');
        label.className = 'reading-key-label';
        label.textContent = defaultLabel;
        button.appendChild(label);
        button.addEventListener('pointerdown', event => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          event.preventDefault();
          submit({ midi, source: 'key' });
        });
        button.addEventListener('click', () => submit({ midi, source: 'key' }));
        bed.appendChild(button);
      });
      blacks.forEach(midi => {
        let left = midi - 1;
        while (!WHITE_PITCH_CLASSES.has(pitchClass(left))) left -= 1;
        const index = whites.indexOf(left);
        if (index < 0) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reading-black';
        button.dataset.midi = String(midi);
        button.dataset.defaultLabel = '';
        button.setAttribute('aria-label', formatPitch(spell(midi, key), settings.naming));
        button.style.left = `calc((100% / var(--white-count)) * ${index + 1})`;
        const label = document.createElement('span');
        label.className = 'reading-key-label';
        button.appendChild(label);
        button.addEventListener('pointerdown', event => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          event.preventDefault();
          submit({ midi, source: 'key' });
        });
        button.addEventListener('click', () => submit({ midi, source: 'key' }));
        bed.appendChild(button);
      });
      els.keyboard.replaceChildren(bed);
    }

    function ensureKeyboard() {
      const { bounds } = currentBounds();
      const signature = `${bounds[0]}-${bounds[1]}-${settings.naming}`;
      if (signature === keyboardSignature && els.keyboard.childElementCount) {
        clearKeyboardMarks();
        return;
      }
      keyboardSignature = signature;
      buildKeyboard(bounds[0], bounds[1]);
    }

    function renderNames() {
      const pool = candidates(settings);
      const seen = new Set();
      const choices = [];
      pool.forEach(note => {
        if (seen.has(note.pc)) return;
        seen.add(note.pc);
        choices.push(note);
      });
      choices.sort((left, right) => left.pc - right.pc);
      const signature = `${settings.naming}:${choices.map(note => note.pc).join(',')}`;
      if (signature === namesSignature && els.names.childElementCount) return;
      namesSignature = signature;
      const fragment = document.createDocumentFragment();
      choices.forEach(note => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reading-name';
        button.dataset.pc = String(note.pc);
        button.textContent = formatClass(note, settings.naming);
        button.addEventListener('pointerdown', event => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          event.preventDefault();
          submit({ pc: note.pc, byName: true, source: 'name' });
        });
        button.addEventListener('click', () =>
          submit({ pc: note.pc, byName: true, source: 'name' })
        );
        fragment.appendChild(button);
      });
      els.names.replaceChildren(fragment);
    }

    function updateHint() {
      els.hint.textContent = hintText(settings);
    }

    function cropEngraving(svg) {
      if (!svg || typeof svg.getBBox !== 'function') return;
      const nodes = svg.querySelectorAll('path, line, ellipse, polygon, polyline, text, use');
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      nodes.forEach(node => {
        let box;
        try {
          box = node.getBBox();
        } catch (error) {
          return;
        }
        if (!box || box.width <= 0 || box.height <= 0) return;
        if (box.width > 5000 || box.height > 5000) return;
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
      });
      if (!Number.isFinite(minX) || maxX - minX < 8 || maxY - minY < 8) return;
      const padX = 18;
      const padY = 16;
      svg.setAttribute(
        'viewBox',
        `${minX - padX} ${minY - padY} ${maxX - minX + padX * 2} ${maxY - minY + padY * 2}`
      );
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.setAttribute('width', '100%');
      svg.removeAttribute('height');
      svg.style.width = '100%';
      svg.style.height = 'auto';
    }

    function clearStaffLabel() {
      els.engrave?.querySelector('#reading-staff-label')?.remove();
    }

    function labelOnStaff(text, tone) {
      const svg = els.engrave?.querySelector('svg');
      if (!svg?.viewBox?.baseVal) return;
      clearStaffLabel();
      if (!text) return;
      const box = svg.viewBox.baseVal;
      if (!(box.width > 0) || !(box.height > 0)) return;
      const font = Math.max(8, box.height * 0.16);
      const pad = font + 3;
      svg.setAttribute('viewBox', `${box.x} ${box.y - pad} ${box.width} ${box.height + pad}`);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.id = 'reading-staff-label';
      label.textContent = text;
      label.setAttribute('x', String(box.x + box.width / 2));
      label.setAttribute('y', String(box.y - 2));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-family', 'system-ui, sans-serif');
      label.setAttribute('font-size', String(font));
      label.setAttribute('font-weight', '700');
      label.setAttribute('fill', tone === 'correct' ? '#1f6b3a' : '#1e1e1b');
      svg.appendChild(label);
    }

    function compactRules() {
      const rules = osmd?.EngravingRules;
      if (!rules) return;
      rules.RenderTitle = false;
      rules.RenderComposer = false;
      rules.RenderPartNames = false;
      rules.RenderMeasureNumbers = false;
      rules.PageTopMargin = 1.5;
      rules.PageBottomMargin = 1.5;
      rules.PageLeftMargin = 1.5;
      rules.PageRightMargin = 1.5;
    }

    async function engrave(xml, token) {
      const Osmd = window.opensheetmusicdisplay?.OpenSheetMusicDisplay;
      if (!Osmd || !els.engrave) {
        if (token === renderToken && els.engrave && !els.engrave.childElementCount) {
          els.engrave.textContent = 'Score engraving is unavailable in this browser.';
        }
        return;
      }
      try {
        if (!osmd) {
          osmd = new Osmd(els.engrave, {
            backend: 'svg',
            autoResize: false,
            drawTitle: false,
            drawSubtitle: false,
            drawComposer: false,
            drawLyricist: false,
            drawCredits: false,
            drawPartNames: false,
            drawPartAbbreviations: false,
            drawFingerings: false,
            drawMeasureNumbers: false,
            drawTimeSignatures: false,
            drawMetronomeMarks: false,
            stretchLastSystemLine: true
          });
          const original = osmd.render.bind(osmd);
          osmd.render = () => {
            original();
            cropEngraving(els.engrave.querySelector('svg'));
          };
        }
        compactRules();
        await osmd.load(xml);
        if (token !== renderToken) return;
        osmd.render();
        if (token !== renderToken) return;
        osmd.cursor?.hide?.();
      } catch (error) {
        console.error(error);
        if (token === renderToken) {
          els.engrave.textContent = 'Could not engrave this note.';
        }
      }
    }

    function holdForEngraving() {
      awaitingEngraving = true;
      session.locked = true;
      session.noteStartedAt = 0;
    }

    function releaseAfterEngraving(token) {
      if (!awaitingEngraving || token !== renderToken) return;
      awaitingEngraving = false;
      if (!shown || finished) return;
      if (timed && !timed.paused && (timed.expired || timed.endsAt <= now())) {
        finishTimed({ recordBest: true });
        return;
      }
      session = arm(session, now());
      renderStats();
    }

    function renderEngraving() {
      if (els.engrave) els.engrave.dataset.clef = settings.clef;
      const token = (renderToken += 1);
      const xml = musicXml(session.prompt?.notes || [], settings);
      holdForEngraving();
      const Osmd = window.opensheetmusicdisplay?.OpenSheetMusicDisplay;
      if (!Osmd || !els.engrave) {
        void engrave(xml, token);
        releaseAfterEngraving(token);
        return;
      }
      const draw = () => {
        if (!shown || token !== renderToken) return;
        engrave(xml, token).then(
          () => releaseAfterEngraving(token),
          () => releaseAfterEngraving(token)
        );
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(draw));
      } else draw();
    }

    function persist() {
      progress.memory = session.memory;
      if (session.streak > progress.bestStreak) progress.bestStreak = session.streak;
      saveProgress(progress);
    }

    function deal() {
      finished = false;
      const prompt = pickPrompt(settings, progress.memory, session.recent, Math.random);
      session = beginPrompt(session, prompt, now());
      ensureKeyboard();
      renderNames();
      setFeedback(prompt.notes.length ? promptStatus() : 'No notes in this range', null);
      setAnswer('');
      renderEngraving();
      renderStats();
    }

    function advanceDelay(last) {
      if (!last?.done && last?.correct) return GROUP_CORRECT_DELAY;
      return last?.correct ? CORRECT_DELAY : WRONG_DELAY;
    }

    function finishTimed({ recordBest = false } = {}) {
      clearTimeout(advanceTimer);
      clearTimeout(clockTimer);
      timed = null;
      finished = true;
      awaitingEngraving = false;
      session.locked = true;
      if (recordBest && session.points > progress.bestTimed) progress.bestTimed = session.points;
      saveProgress(progress);
      const summary = summarize(session.attempts);
      setFeedback(
        `Time · ${session.points} points · ${formatAccuracy(summary.accuracy, summary.answered)}`,
        null
      );
      renderStats();
    }

    function tickClock() {
      if (!timed || timed.paused) return;
      const left = timed.endsAt - now();
      renderStats();
      if (left <= 0) {
        timed.expired = true;
        if (!session.locked) finishTimed({ recordBest: true });
        return;
      }
      clockTimer = window.setTimeout(tickClock, 200);
    }

    function stopTimed() {
      clearTimeout(clockTimer);
      timed = null;
      finished = false;
    }

    function startTimed() {
      clearTimeout(advanceTimer);
      stopTimed();
      session = createSession(progress.memory);
      timed = { endsAt: now() + 60000, paused: false, expired: false, remaining: 60000 };
      deal();
      tickClock();
    }

    function continueAfter(last) {
      if (timed?.expired || (timed && !timed.paused && timed.endsAt <= now())) {
        finishTimed({ recordBest: true });
        return;
      }
      if (last?.done) {
        deal();
        return;
      }
      session = arm(session, now());
      clearKeyboardMarks();
      clearStaffLabel();
      setFeedback(promptStatus(), null);
      setAnswer('');
      renderStats();
    }

    function submit(input) {
      if (!shown || session.locked || finished || !session.prompt) return;
      const notes = session.prompt.notes || [];
      if (session.index >= notes.length) return;
      if (!input.byName && !input.skip && input.source === 'keyboard') {
        const { bounds } = currentBounds();
        if (input.midi < bounds[0] || input.midi > bounds[1]) return;
      }
      if (!input.byName && !input.skip && !Number.isInteger(input.midi)) return;
      session = answerPrompt(session, input, now());
      session.locked = true;
      const last = session.last;
      persist();
      const expectedName = formatPitch(last.expected, settings.naming);
      if (last.correct) {
        setFeedback('Correct', 'correct');
        setAnswer(expectedName);
      } else if (last.skip) {
        setFeedback('It was', 'wrong');
        setAnswer(expectedName);
      } else if (last.byName) {
        const played =
          candidates(settings).find(note => note.pc === input.pc) ||
          spell(input.pc, keyById(settings.key));
        setFeedback(`Not ${formatClass(played, settings.naming)}`, 'wrong');
        setAnswer(expectedName);
      } else if (Number.isInteger(last.playedMidi)) {
        const played = spell(last.playedMidi, keyById(settings.key));
        const playedName = formatPitch(played, settings.naming);
        setFeedback(
          played.pc === last.expected.pc ? 'Wrong octave' : `You played ${playedName}`,
          'wrong'
        );
        setAnswer(expectedName);
      } else {
        setFeedback('It was', 'wrong');
        setAnswer(expectedName);
      }
      labelOnStaff(expectedName, last.correct ? 'correct' : 'wrong');
      paintKeyboard(last);
      const pitch = last.expected.pitch;
      window.PianoApp?.playPitch?.(pitch, last.correct ? 0.55 : 0.7);
      renderStats();
      clearTimeout(advanceTimer);
      advanceTimer = window.setTimeout(() => continueAfter(last), advanceDelay(last));
    }

    function onSettingsChange() {
      readDom();
      updateHint();
      namesSignature = '';
      renderNames();
      ensureKeyboard();
      if (session.locked) return;
      clearTimeout(advanceTimer);
      deal();
    }

    function onKeyDown(event) {
      if (!shown) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const tag = event.target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        event.target?.isContentEditable
      )
        return;
      if (event.code === 'Space' || event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const { base, bounds } = currentBounds();
      const midi = midiForCode(event.code, base);
      if (midi == null) return;
      event.preventDefault();
      event.stopPropagation();
      if (midi < bounds[0] || midi > bounds[1]) return;
      submit({ midi, source: 'keyboard' });
    }

    function onMidiMessage(event) {
      const midi = midiMessageNote(event.data);
      if (midi == null) return;
      submit({ midi, source: 'midi' });
    }

    function watchMidi(access) {
      const inputs = [...access.inputs.values()];
      inputs.forEach(input => {
        input.onmidimessage = onMidiMessage;
      });
      els.midi.textContent = 'MIDI on';
      els.midiStatus.textContent = inputs.length
        ? inputs
            .map(input => input.name)
            .filter(Boolean)
            .join(', ')
        : 'Waiting for a keyboard';
      access.onstatechange = () => watchMidi(access);
    }

    async function connectMidi() {
      if (!navigator.requestMIDIAccess) {
        els.midiStatus.textContent = 'MIDI is not available in this browser';
        return;
      }
      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        watchMidi(access);
      } catch (error) {
        console.warn('MIDI permission was not granted', error);
        els.midiStatus.textContent = 'MIDI permission was blocked';
      }
    }

    function onShow() {
      shown = true;
      applyDom();
      ensureKeyboard();
      renderNames();
      updateHint();
      if (timed?.paused) {
        timed.paused = false;
        timed.endsAt = now() + timed.remaining;
        tickClock();
      }
      if (finished) {
        renderStats();
        return;
      }
      const notes = session.prompt?.notes || [];
      if (!session.prompt || session.index >= notes.length) deal();
      else {
        setFeedback(promptStatus(), null);
        renderEngraving();
        renderStats();
      }
    }

    function onHide() {
      shown = false;
      clearTimeout(advanceTimer);
      session.locked = false;
      if (timed && !finished) {
        clearTimeout(clockTimer);
        timed.remaining = Math.max(0, timed.endsAt - now());
        timed.paused = true;
      }
    }

    function forcePrompt(midis) {
      const key = keyById(settings.key);
      const notes = midis.map(midi => spell(midi, key));
      clearTimeout(advanceTimer);
      finished = false;
      session.locked = false;
      session = beginPrompt(
        session,
        { notes, staff: clefForMidi(notes[0].midi, settings.clef) },
        now()
      );
      ensureKeyboard();
      renderNames();
      setFeedback(promptStatus(), null);
      setAnswer('');
      renderEngraving();
      renderStats();
    }

    els.clef.addEventListener('change', onSettingsChange);
    els.range.addEventListener('change', onSettingsChange);
    els.key.addEventListener('change', onSettingsChange);
    els.accidentals.addEventListener('change', onSettingsChange);
    els.naming.addEventListener('change', onSettingsChange);
    els.group.addEventListener('change', onSettingsChange);
    els.reset.addEventListener('click', () => {
      clearTimeout(advanceTimer);
      stopTimed();
      session = createSession(progress.memory);
      deal();
    });
    els.skip.addEventListener('click', () => submit({ skip: true }));
    els.timed.addEventListener('click', () => {
      if (timed && !timed.paused) {
        finishTimed({ recordBest: false });
        return;
      }
      if (finished) {
        clearTimeout(advanceTimer);
        stopTimed();
        session = createSession(progress.memory);
        deal();
        return;
      }
      startTimed();
    });
    els.midi.addEventListener('click', () => {
      connectMidi();
    });
    window.addEventListener('keydown', onKeyDown, true);

    applyDom();
    renderNames();
    updateHint();
    renderStats();

    api.onShow = onShow;
    api.onHide = onHide;
    api.forcePrompt = forcePrompt;
    api.getControllerState = () => ({
      settings,
      shown,
      finished,
      points: session.points,
      streak: session.streak,
      index: session.index,
      locked: session.locked,
      noteStartedAt: session.noteStartedAt,
      timed: Boolean(timed && !timed.paused),
      prompt: session.prompt
    });
  }

  mount();
  window.NoteReading = api;
})();
