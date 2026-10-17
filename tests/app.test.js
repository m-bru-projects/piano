import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.js';

function black(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

function installAudio() {
  class FakeParam {
    constructor() {
      this.value = 0;
    }
    setValueAtTime() {}
    exponentialRampToValueAtTime() {}
    cancelScheduledValues() {}
  }
  class FakeNode {
    constructor() {
      this.frequency = new FakeParam();
      this.gain = new FakeParam();
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
}

describe('score and transport', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    bootApp();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('keeps an engraved-score container and applies an imported tempo', () => {
    expect(document.getElementById('osmdContainer')).toBeTruthy();
    expect(document.getElementById('scoreSvg')).toBeNull();
    window.PianoApp.setPiece({
      id: 'six-eight',
      title: 'Six eight',
      composer: 'Test',
      description: 'Meter test',
      key: 'C major',
      timeSignature: [6, 8],
      tempo: 200,
      level: 'Test',
      bars: [
        { start: 0, end: 3, number: 1, implicit: false, beats: 6, beatType: 8 },
        { start: 3, end: 6, number: 2, implicit: false, beats: 6, beatType: 8 }
      ],
      notes: [
        { pitch: 'C4', start: 0, duration: 1.5, hand: 'right' },
        { pitch: 'E4', start: 1.5, duration: 1.5, hand: 'right' }
      ]
    });
    expect(document.getElementById('tempo').max).toBe('240');
    expect(document.getElementById('tempo').value).toBe('200');
    expect(document.getElementById('tempoValue').textContent).toBe('200 BPM');
  });

  it('clamps an out-of-range tempo onto the slider', () => {
    window.PianoApp.setPiece({
      id: 'slow',
      title: 'Slow',
      composer: 'Test',
      description: 'Tempo',
      key: 'C major',
      timeSignature: [4, 4],
      tempo: 12,
      level: 'Test',
      notes: [{ pitch: 'C4', start: 0, duration: 4, hand: 'right' }]
    });
    expect(window.PianoApp.getState().tempo).toBe(30);
    expect(document.getElementById('tempo').value).toBe('30');
    expect(document.getElementById('tempo').min).toBe('30');
  });

  it('ends the falling-note keyboard on white keys', () => {
    window.PianoApp.setPiece({
      id: 'black-ends',
      title: 'Black ends',
      composer: 'Test',
      description: 'Keyboard',
      key: 'C major',
      timeSignature: [4, 4],
      tempo: 90,
      level: 'Test',
      notes: [
        { pitch: 'C#4', start: 0, duration: 1, hand: 'right' },
        { pitch: 'F#5', start: 1, duration: 1, hand: 'right' }
      ]
    });
    const [minMidi, maxMidi] = window.PianoApp.keyboardRange();
    expect(black(minMidi)).toBe(false);
    expect(black(maxMidi)).toBe(false);
    expect(maxMidi % 12).toBe(0);
  });

  it('steps bars with the arrow keys and toggles playback with space', () => {
    window.PianoApp.setPiece(window.PIANO_PIECES[0]);
    expect(window.PianoApp.getState().beat).toBe(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));
    expect(window.PianoApp.getState().beat).toBe(4);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true }));
    expect(window.PianoApp.getState().beat).toBe(0);

    const tempo = document.getElementById('tempo');
    tempo.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    expect(window.PianoApp.getState().playing).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    expect(window.PianoApp.getState().playing).toBe(true);
    expect(document.getElementById('playLabel').textContent).toBe('Pause');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    expect(window.PianoApp.getState().playing).toBe(false);
    expect(document.getElementById('playLabel').textContent).toBe('Play');
  });

  it('maps a sheet click to a note, a beat, or nothing outside the system', () => {
    const model = {
      noteRadius: 1.8,
      systemSlack: 4,
      notes: [
        { x: 12, y: 20, beat: 0 },
        { x: 24, y: 20, beat: 1 },
        { x: 36, y: 20, beat: 2 },
        { x: 48, y: 20, beat: 3 },
        { x: 70, y: 20, beat: 5.25 }
      ],
      systems: [
        {
          top: 10,
          bottom: 50,
          left: 0,
          right: 100,
          measures: [
            {
              left: 4,
              right: 52,
              startBeat: 0,
              endBeat: 4,
              beatUnit: 1,
              anchors: [
                { x: 12, beat: 0 },
                { x: 24, beat: 1 },
                { x: 36, beat: 2 },
                { x: 48, beat: 3 }
              ]
            },
            {
              left: 52,
              right: 100,
              startBeat: 4,
              endBeat: 8,
              beatUnit: 1,
              anchors: [
                { x: 60, beat: 4 },
                { x: 70, beat: 5.25 }
              ]
            }
          ]
        },
        {
          top: 70,
          bottom: 110,
          left: 0,
          right: 40,
          measures: [
            {
              left: 2,
              right: 40,
              startBeat: 0,
              endBeat: 3,
              beatUnit: 0.5,
              anchors: [
                { x: 8, beat: 0 },
                { x: 24, beat: 1.5 }
              ]
            }
          ]
        }
      ]
    };
    const beat = point => window.PianoApp.beatForSheetClick(point, model);

    expect(beat({ x: 12, y: 20 })).toBe(0);
    expect(beat({ x: 24.6, y: 20.4 })).toBe(1);
    expect(beat({ x: 30, y: 42 })).toBe(2);
    expect(beat({ x: 15, y: 42 })).toBe(0);
    expect(beat({ x: 2, y: 30 })).toBe(0);
    expect(beat({ x: 20, y: 140 })).toBeNull();

    const held = {
      noteRadius: 1.8,
      systemSlack: 4,
      notes: [{ x: 20, y: 20, beat: 0 }],
      systems: [
        {
          top: 10,
          bottom: 40,
          left: 0,
          right: 80,
          measures: [
            {
              left: 0,
              right: 80,
              startBeat: 0,
              endBeat: 4,
              beatUnit: 1,
              anchors: [{ x: 20, beat: 0 }]
            }
          ]
        }
      ]
    };
    expect(window.PianoApp.beatForSheetClick({ x: 20, y: 20 }, held)).toBe(0);
    expect(window.PianoApp.beatForSheetClick({ x: 50, y: 30 }, held)).toBe(2);

    expect(beat({ x: 70, y: 20 })).toBe(5.25);
    expect(beat({ x: 69.5, y: 42 })).toBe(5.25);
    expect(beat({ x: 90, y: 30 })).toBe(7);
    expect(beat({ x: 16, y: 90 })).toBe(1);
    expect(beat({ x: 130, y: 30 })).toBeNull();
  });

  it('starts playback from a clicked beat and jumps there while already playing', () => {
    window.PianoApp.setPiece(window.PIANO_PIECES[0]);
    expect(window.PianoApp.getState().playing).toBe(false);
    expect(window.PianoApp.getState().beat).toBe(0);

    window.PianoApp.playFromBeat(4);
    expect(window.PianoApp.getState().playing).toBe(true);
    expect(window.PianoApp.getState().beat).toBe(4);
    expect(document.getElementById('playLabel').textContent).toBe('Pause');
    expect(document.getElementById('currentTime').textContent).not.toBe('0:00');

    window.PianoApp.playFromBeat(7);
    expect(window.PianoApp.getState().playing).toBe(true);
    expect(window.PianoApp.getState().beat).toBe(7);

    window.PianoApp.playFromBeat(16);
    expect(window.PianoApp.getState().playing).toBe(true);
    expect(window.PianoApp.getState().beat).toBe(15);

    document.getElementById('playButton').click();
    expect(window.PianoApp.getState().playing).toBe(false);
    expect(window.PianoApp.getState().beat).toBe(15);
    expect(document.getElementById('playLabel').textContent).toBe('Play');

    document.getElementById('playButton').click();
    expect(window.PianoApp.getState().playing).toBe(true);
    expect(window.PianoApp.getState().beat).toBe(15);

    document.getElementById('restartButton').click();
    expect(window.PianoApp.getState().playing).toBe(false);
    expect(window.PianoApp.getState().beat).toBe(0);
    expect(document.getElementById('playLabel').textContent).toBe('Play');

    const stage = document.getElementById('scoreStage');
    stage.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: 12, clientY: 12, bubbles: true, button: 0 })
    );
    window.dispatchEvent(
      new MouseEvent('pointerup', { clientX: 12, clientY: 12, bubbles: true, button: 0 })
    );
    stage.dispatchEvent(
      new MouseEvent('click', { clientX: 12, clientY: 12, bubbles: true, button: 0 })
    );
    expect(window.PianoApp.getState().playing).toBe(false);
    expect(window.PianoApp.getState().beat).toBe(0);
  });
});
