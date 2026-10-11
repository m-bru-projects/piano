import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.js';

function loadSamples() {
  window.eval(fs.readFileSync(path.join(root, 'piano-samples.js'), 'utf8'));
  return window.PianoSamples;
}

describe('piano sample mapping', () => {
  const samples = loadSamples();

  it('pitch-shifts from the nearest minor-third sample and prefers the lower one on a tie', () => {
    expect(samples.SAMPLE_MIDIS).toHaveLength(29);
    expect(samples.SAMPLE_MIDIS[0]).toBe(24);
    expect(samples.SAMPLE_MIDIS.at(-1)).toBe(108);

    const c4 = samples.nearestSample(60);
    expect(c4).toEqual({ midi: 60, name: 'C4', playbackRate: 1 });

    const csharp = samples.nearestSample(61);
    expect(csharp.name).toBe('C4');
    expect(csharp.playbackRate).toBeCloseTo(2 ** (1 / 12), 12);

    const e4 = samples.nearestSample(64);
    expect(e4.name).toBe('Ds4');
    expect(e4.midi).toBe(63);
    expect(e4.playbackRate).toBeCloseTo(2 ** (1 / 12), 12);

    const tie = samples.nearestSample(61.5);
    expect(tie.midi).toBe(60);
    expect(tie.playbackRate).toBeCloseTo(2 ** (1.5 / 12), 12);

    const a0 = samples.nearestSample(21);
    expect(a0.name).toBe('C1');
    expect(a0.playbackRate).toBeCloseTo(2 ** (-3 / 12), 12);

    const above = samples.nearestSample(110);
    expect(above.name).toBe('C8');
    expect(above.playbackRate).toBeCloseTo(2 ** (2 / 12), 12);

    expect(samples.nearestSample(Number.NaN)).toBeNull();
    expect(samples.sampleUrl('C4')).toBe('samples/piano/C4.mp3');
  });

  it('maps velocity to a gain and keeps a default when a note has none', () => {
    expect(samples.velocityGain({ pitch: 'C4' })).toBe(0.82);
    expect(samples.velocityGain({ velocity: 0.5 })).toBe(0.5);
    expect(samples.velocityGain({ velocity: 1 })).toBe(1);
    expect(samples.velocityGain({ velocity: 127 })).toBe(1);
    expect(samples.velocityGain({ velocity: 64 })).toBeCloseTo(64 / 127, 12);
    expect(samples.velocityGain({ velocity: 0 })).toBe(0);
    expect(samples.velocityGain({ velocity: 'loud' })).toBe(0.82);
  });

  it('ships the mapped files as a small MP3 set', () => {
    const dir = path.join(root, 'samples/piano');
    const expected = samples.SAMPLE_MIDIS.map(midi => `${samples.sampleName(midi)}.mp3`).sort();
    const files = fs
      .readdirSync(dir)
      .filter(name => name.endsWith('.mp3'))
      .sort();
    expect(files).toEqual(expected);
    const bytes = files.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);
    expect(bytes).toBeGreaterThan(200 * 1024);
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
  });
});
