import fs from 'node:fs';
import path from 'node:path';
import { loadImporter, root } from './helpers.js';

const api = loadImporter();
window.eval(fs.readFileSync(path.join(root, 'musicxml-export.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(root, 'data.js'), 'utf8'));

function sounding(piece) {
  return piece.notes
    .map(note => [note.pitch, note.start, note.duration, note.hand, note.finger || 0])
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]) || a[3].localeCompare(b[3]));
}

describe('MusicXML export for engraved demos', () => {
  it('round-trips the C major scale, including both hands and fingerings', () => {
    const source = window.PIANO_PIECES[0];
    const parsed = api.parse(window.notesToMusicXml(source), 'c-major-scale.musicxml');
    expect(parsed.timeSignature).toEqual([4, 4]);
    expect(parsed.tempo).toBe(80);
    expect(parsed.key).toBe('C major');
    expect(parsed.bars.map(bar => [bar.start, bar.end, bar.number])).toEqual([
      [0, 4, 1],
      [4, 8, 2],
      [8, 12, 3],
      [12, 16, 4]
    ]);
    expect(sounding(parsed)).toEqual(sounding(source));
    expect(parsed.musicXml).toContain('<fingering>1</fingering>');
    expect(parsed.musicXml).toContain('<sign>G</sign>');
    expect(parsed.musicXml).toContain('<sign>F</sign>');
  });

  it('writes a 3-quarter 6/8 bar, a pickup, and a later time signature', () => {
    const six = api.parse(
      window.notesToMusicXml({
        title: 'Six eight',
        composer: 'Test',
        key: 'C major',
        timeSignature: [6, 8],
        tempo: 96,
        bars: [
          { start: 0, end: 3, number: 1, implicit: false, beats: 6, beatType: 8 },
          { start: 3, end: 6, number: 2, implicit: false, beats: 6, beatType: 8 }
        ],
        notes: [
          { pitch: 'C4', start: 0, duration: 1.5, hand: 'right' },
          { pitch: 'E4', start: 1.5, duration: 1.5, hand: 'right' },
          { pitch: 'G3', start: 0, duration: 3, hand: 'left' }
        ]
      })
    );
    expect(six.bars.map(bar => [bar.start, bar.end, bar.beats, bar.beatType])).toEqual([
      [0, 3, 6, 8],
      [3, 6, 6, 8]
    ]);
    expect(sounding(six)).toEqual([
      ['C4', 0, 1.5, 'right', 0],
      ['G3', 0, 3, 'left', 0],
      ['E4', 1.5, 1.5, 'right', 0]
    ]);
    expect(six.musicXml).toContain('<dot/>');

    const pickup = api.parse(
      window.notesToMusicXml({
        title: 'Pickup',
        composer: 'Test',
        key: 'A minor',
        timeSignature: [3, 4],
        tempo: 72,
        bars: [
          { start: 0, end: 1, number: null, implicit: true, beats: 3, beatType: 4 },
          { start: 1, end: 4, number: 1, implicit: false, beats: 3, beatType: 4 },
          { start: 4, end: 7, number: 2, implicit: false, beats: 6, beatType: 8 }
        ],
        notes: [
          { pitch: 'E5', start: 0, duration: 1, hand: 'right' },
          { pitch: 'C5', start: 1, duration: 3, hand: 'right' },
          { pitch: 'G4', start: 4, duration: 3, hand: 'right' }
        ]
      })
    );
    expect(pickup.key).toBe('A minor');
    expect(pickup.bars[0]).toMatchObject({ start: 0, end: 1, implicit: true, number: null });
    expect(pickup.bars[1]).toMatchObject({ start: 1, end: 4, beats: 3, beatType: 4, number: 1 });
    expect(pickup.bars[2]).toMatchObject({ start: 4, end: 7, beats: 6, beatType: 8, number: 2 });
    expect(sounding(pickup)).toEqual([
      ['E5', 0, 1, 'right', 0],
      ['C5', 1, 3, 'right', 0],
      ['G4', 4, 3, 'right', 0]
    ]);
  });

  it('ties a note that crosses a bar back into one sounding note', () => {
    const parsed = api.parse(
      window.notesToMusicXml({
        title: 'Tie',
        composer: 'Test',
        key: 'F major',
        timeSignature: [4, 4],
        tempo: 90,
        notes: [
          { pitch: 'C4', start: 3, duration: 2, hand: 'right', finger: 1 },
          { pitch: 'E4', start: 0, duration: 1, hand: 'right' },
          { pitch: 'G4', start: 0, duration: 1, hand: 'right' }
        ]
      })
    );
    expect(parsed.key).toBe('F major');
    expect(parsed.musicXml).toContain('<tie type="start"/>');
    expect(parsed.musicXml).toContain('<tie type="stop"/>');
    const tied = parsed.notes.find(note => note.pitch === 'C4');
    expect(tied).toMatchObject({ start: 3, duration: 2, hand: 'right', finger: 1 });
    expect(
      parsed.notes
        .filter(note => note.start === 0)
        .map(note => note.pitch)
        .sort()
    ).toEqual(['E4', 'G4']);
  });
});
