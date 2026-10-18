import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.js';

function loadReading() {
  window.eval(fs.readFileSync(path.join(root, 'note-reading.js'), 'utf8'));
  return window.NoteReading;
}

function installAudio() {
  class FakeParam {
    constructor() {
      this.value = 0;
    }
    setValueAtTime() {}
    exponentialRampToValueAtTime() {}
    linearRampToValueAtTime() {}
    cancelScheduledValues() {}
  }
  class FakeNode {
    constructor() {
      this.frequency = new FakeParam();
      this.gain = new FakeParam();
      this.playbackRate = new FakeParam();
    }
    connect() {}
    start() {}
    stop() {}
  }
  window.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
    }
    resume() {}
    createOscillator() {
      return new FakeNode();
    }
    createGain() {
      return new FakeNode();
    }
  };
}

function bootApp() {
  document.open();
  document.write(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  document.close();
  installAudio();
  window.eval(fs.readFileSync(path.join(root, 'data.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'note-reading.js'), 'utf8'));
}

describe('note reading', () => {
  /** @type {Window['NoteReading']} */
  let reading;

  beforeAll(() => {
    localStorage.clear();
    reading = loadReading();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps page assets relative so GitHub Pages can serve /piano/', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html).toContain('src="./note-reading.js"');
    expect(html).toContain('href="./styles.css"');
    expect(html).not.toMatch(/\b(?:src|href)="\//);
  });

  it('uses middle C ± a fifth, and a smaller slice on one clef', () => {
    const settings = reading.defaultSettings();
    expect(reading.rangeFor({ ...settings, clef: 'both' })).toEqual({ min: 53, max: 67 });
    expect(reading.rangeFor({ ...settings, clef: 'treble' })).toEqual({ min: 60, max: 67 });
    expect(reading.rangeFor({ ...settings, clef: 'bass' })).toEqual({ min: 53, max: 60 });
    expect(reading.rangeFor({ ...settings, clef: 'both', range: 'full' })).toEqual({
      min: 36,
      max: 84
    });
  });

  it('spells signature notes and keeps other accidentals out until asked', () => {
    const g = reading.keyById('G');
    const f = reading.keyById('F');
    expect(reading.spell(66, g).pitch).toBe('F#4');
    expect(reading.spell(58, f).pitch).toBe('Bb3');
    expect(reading.diatonicPitchClasses('G')).toEqual([0, 2, 4, 6, 7, 9, 11]);
    expect(reading.diatonicPitchClasses('F')).toEqual([0, 2, 4, 5, 7, 9, 10]);
    expect(reading.diatonicPitchClasses('Em')).toEqual([0, 2, 4, 6, 7, 9, 11]);
    expect(reading.diatonicPitchClasses('Dm')).toEqual([0, 2, 4, 5, 7, 9, 10]);
    expect(reading.diatonicPitchClasses('Am')).toEqual([0, 2, 4, 5, 7, 9, 11]);

    const beginner = { ...reading.defaultSettings(), clef: 'treble', key: 'G' };
    expect(reading.candidates(beginner).map(note => note.pitch)).toEqual([
      'C4',
      'D4',
      'E4',
      'F#4',
      'G4'
    ]);
    expect(
      reading.candidates({ ...beginner, accidentals: true }).some(note => note.pitch === 'F4')
    ).toBe(true);
    const both = { ...reading.defaultSettings(), clef: 'both', key: 'F' };
    expect(reading.candidates(both).some(note => note.pitch === 'Bb3')).toBe(true);
    expect(reading.candidates(both).some(note => note.pitch === 'A#3')).toBe(false);
  });

  it('names notes in letters or fixed-do solfège', () => {
    const c = reading.keyById('C');
    const g = reading.keyById('G');
    const f = reading.keyById('F');
    expect(reading.formatPitch(reading.spell(60, c), 'letters')).toBe('C4');
    expect(reading.formatPitch(reading.spell(66, g), 'solfege')).toBe('Fa♯ 4');
    expect(reading.formatClass(reading.spell(58, f), 'solfege')).toBe('Si♭');
    expect(reading.formatClass(reading.spell(60, c), 'solfege')).toBe('Do');
  });

  it('biases the next note toward misses and away from the last few', () => {
    const key = reading.keyById('C');
    const pool = [reading.spell(60, key), reading.spell(64, key)];
    const memory = {
      60: { seen: 5, wrong: 0, correct: 5, streak: 5 },
      64: { seen: 5, wrong: 5, correct: 0, streak: 0 }
    };
    expect(reading.weightFor(pool[1], memory, [])).toBeGreaterThan(
      reading.weightFor(pool[0], memory, []) * 5
    );
    expect(reading.pickNotes(pool, 1, memory, [], () => 0.5)[0].midi).toBe(64);
    expect(reading.weightFor(pool[1], memory, [64])).toBeLessThan(
      reading.weightFor(pool[1], memory, [])
    );

    const next = reading.recordAnswer(memory, 64, false);
    expect(memory[64].wrong).toBe(5);
    expect(next[64]).toEqual({ seen: 6, wrong: 6, correct: 0, streak: 0 });
  });

  it('keeps a group on one staff and grades names apart from octaves', () => {
    const settings = { ...reading.defaultSettings(), clef: 'both', group: 3 };
    const prompt = reading.pickPrompt(settings, {}, [], () => 0);
    expect(prompt.notes).toHaveLength(3);
    prompt.notes.forEach(note => {
      expect(reading.clefForMidi(note.midi, 'both')).toBe(prompt.staff);
    });
    expect(reading.clefForMidi(60, 'both')).toBe('treble');
    expect(reading.clefForMidi(59, 'both')).toBe('bass');

    let session = reading.beginPrompt(reading.createSession(), prompt, 1000);
    session = reading.answerPrompt(session, { midi: prompt.notes[0].midi }, 1400);
    expect(session.last.correct).toBe(true);
    expect(session.last.done).toBe(false);
    expect(session.points).toBe(10);
    session = reading.arm(session, 1500);
    session = reading.answerPrompt(session, { pc: prompt.notes[1].pc, byName: true }, 1900);
    expect(session.last.correct).toBe(true);
    expect(session.streak).toBe(2);
    expect(session.points).toBe(22);
    session = reading.arm(session, 2000);
    session = reading.answerPrompt(session, { midi: prompt.notes[2].midi + 12 }, 2400);
    expect(session.last.correct).toBe(false);
    expect(session.last.done).toBe(true);
    expect(session.streak).toBe(0);

    const summary = reading.summarize(session.attempts);
    expect(summary.correct).toBe(2);
    expect(summary.accuracy).toBeCloseTo(2 / 3);
    expect(summary.averageMs).toBeCloseTo((400 + 400 + 400) / 3);
    expect(reading.pointsFor(true, 10)).toBe(30);
    expect(reading.formatReaction(840)).toBe('840 ms');
    expect(reading.formatAccuracy(summary.accuracy, summary.answered)).toBe('67%');
  });

  it('writes engraved MusicXML for one clef or a grand staff', () => {
    const g = reading.spell(66, reading.keyById('G'));
    const treble = reading.musicXml([g], { clef: 'treble', key: 'G' });
    expect(treble).toContain('<fifths>1</fifths>');
    expect(treble).toContain('<mode>major</mode>');
    expect(treble).toContain('<sign>G</sign>');
    expect(treble).toContain('<step>F</step><alter>1</alter><octave>4</octave>');
    expect(treble).not.toContain('<staves>2</staves>');

    const middle = reading.spell(60, reading.keyById('C'));
    const grand = reading.musicXml([middle], { clef: 'both', key: 'C' });
    expect(grand).toContain('<staves>2</staves>');
    expect(grand).toContain('<sign>F</sign>');
    expect(grand).toContain('<staff>1</staff>');
    expect(grand).toContain('<rest/>');

    const low = reading.spell(48, reading.keyById('C'));
    const bass = reading.musicXml([low], { clef: 'bass', key: 'Am' });
    expect(bass).toContain('<sign>F</sign>');
    expect(bass).toContain('<mode>minor</mode>');
    expect(bass).toContain('<step>C</step><octave>3</octave>');
    expect(bass).not.toContain('<staves>2</staves>');

    const group = reading.musicXml(
      [
        reading.spell(60, reading.keyById('C')),
        reading.spell(62, reading.keyById('C')),
        reading.spell(64, reading.keyById('C'))
      ],
      { clef: 'treble', key: 'C' }
    );
    expect(group.match(/<step>/g)).toHaveLength(3);
    expect(group).toContain('<rest/>');
    expect(group).toContain('<type>quarter</type>');
  });

  it('maps the computer keyboard and MIDI note-ons from a C', () => {
    expect(reading.keyboardBounds(53, 67)).toEqual([48, 72]);
    expect(reading.baseMidi(60, 67)).toBe(60);
    expect(reading.baseMidi(53, 67)).toBe(48);
    expect(reading.midiForCode('KeyZ', 60)).toBe(60);
    expect(reading.midiForCode('KeyX', 60)).toBe(62);
    expect(reading.midiForCode('KeyQ', 60)).toBe(72);
    expect(reading.midiForCode('Digit2', 48)).toBe(61);
    expect(reading.midiForCode('KeyA', 60)).toBeNull();
    expect(reading.midiMessageNote([0x90, 64, 80])).toBe(64);
    expect(reading.midiMessageNote([0x90, 64, 0])).toBeNull();
    expect(reading.midiMessageNote([0x80, 64, 0])).toBeNull();
  });

  it('remembers settings and best scores', () => {
    expect(reading.sanitizeSettings({ clef: 'nope', group: 9, key: 'F' })).toEqual({
      ...reading.defaultSettings(),
      key: 'F'
    });
    reading.saveSettings({
      ...reading.defaultSettings(),
      clef: 'bass',
      accidentals: true,
      naming: 'solfege'
    });
    expect(reading.loadSettings()).toMatchObject({
      clef: 'bass',
      accidentals: true,
      naming: 'solfege'
    });
    reading.saveProgress({
      bestStreak: 4,
      bestTimed: 80,
      memory: { 64: { seen: 2, wrong: 1, correct: 1, streak: 0 } }
    });
    const progress = reading.loadProgress();
    expect(progress.bestStreak).toBe(4);
    expect(progress.bestTimed).toBe(80);
    expect(progress.memory[64].wrong).toBe(1);
  });
});

describe('note reading UI', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    localStorage.clear();
    bootApp();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  function openReading() {
    document.querySelector('[data-view="reading"]').click();
  }

  function key(code) {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true })
    );
  }

  it('opens the tab without starting score playback', () => {
    openReading();
    expect(document.body.classList.contains('is-reading')).toBe(true);
    expect(document.getElementById('readingPanel').classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('scorePanel').classList.contains('is-hidden')).toBe(true);
    expect(document.getElementById('fallingPanel').classList.contains('is-hidden')).toBe(true);
    expect(document.querySelectorAll('#readingKeyboard .reading-white').length).toBeGreaterThan(7);
    key('Space');
    expect(window.PianoApp.getState().playing).toBe(false);
    expect(window.PianoApp.getState().view).toBe('reading');
    expect(typeof window.PianoApp.playPitch).toBe('function');
    expect(() => window.PianoApp.playPitch('C4', 0.4)).not.toThrow();
  });

  it('grades the keyboard, the computer keys, and the name buttons', () => {
    openReading();
    window.NoteReading.forcePrompt([60]);
    key('KeyZ');
    expect(document.getElementById('readingFeedback').textContent).toBe('Correct');
    expect(document.getElementById('readingAnswer').textContent).toBe('C4');
    expect(
      document.querySelector('#readingKeyboard [data-midi="60"]').classList.contains('is-correct')
    ).toBe(true);
    expect(document.getElementById('readingPoints').textContent).not.toBe('0');

    window.NoteReading.forcePrompt([60]);
    key('KeyX');
    expect(document.getElementById('readingFeedback').textContent).toBe('You played D4');
    expect(document.getElementById('readingAnswer').textContent).toBe('C4');
    expect(
      document.querySelector('#readingKeyboard [data-midi="62"]').classList.contains('is-wrong')
    ).toBe(true);
    expect(
      document.querySelector('#readingKeyboard [data-midi="60"]').classList.contains('is-target')
    ).toBe(true);

    window.NoteReading.forcePrompt([60]);
    document.querySelector('#readingKeyboard [data-midi="72"]').click();
    expect(document.getElementById('readingFeedback').textContent).toBe('Wrong octave');
    expect(document.getElementById('readingAnswer').textContent).toBe('C4');

    window.NoteReading.forcePrompt([67]);
    document.querySelector('#readingNames [data-pc="7"]').click();
    expect(document.getElementById('readingFeedback').textContent).toBe('Correct');
    expect(document.getElementById('readingAnswer').textContent).toBe('G4');

    window.NoteReading.forcePrompt([64]);
    document.getElementById('readingNaming').value = 'solfege';
    document.getElementById('readingNaming').dispatchEvent(new Event('change', { bubbles: true }));
    window.NoteReading.forcePrompt([64]);
    expect(document.querySelector('#readingNames [data-pc="0"]').textContent).toBe('Do');
    document.querySelector('#readingNames [data-pc="4"]').click();
    expect(document.getElementById('readingAnswer').textContent).toBe('Mi 4');
  });

  it('saves settings, runs a timed drill, and returns to the score', () => {
    openReading();
    expect(document.querySelector('#readingNames [data-pc="1"]')).toBeNull();
    document.getElementById('readingAccidentals').checked = true;
    document
      .getElementById('readingAccidentals')
      .dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.querySelector('#readingNames [data-pc="1"]')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('piano-note-reading-settings')).accidentals).toBe(true);

    document.getElementById('readingTimed').click();
    expect(document.getElementById('readingTimed').textContent).toBe('Stop');
    expect(document.getElementById('readingClock').classList.contains('is-hidden')).toBe(false);
    window.NoteReading.forcePrompt([60]);
    key('KeyZ');
    document.getElementById('readingTimed').click();
    expect(document.getElementById('readingFeedback').textContent).toMatch(/^Time/);
    expect(document.getElementById('readingBest').textContent).toMatch(/Best 60s/);

    document.querySelector('[data-view="score"]').click();
    expect(document.body.classList.contains('is-reading')).toBe(false);
    expect(document.getElementById('scorePanel').classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('readingPanel').classList.contains('is-hidden')).toBe(true);
    expect(window.PianoApp.getState().view).toBe('score');
  });
});
