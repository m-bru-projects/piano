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
});
