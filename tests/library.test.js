import fs from 'node:fs';
import path from 'node:path';
import { loadImporter, root } from './helpers.js';

const api = loadImporter();
const PITCH = /^[A-G](#|b)?-?\d+$/;

describe('standard library', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'library/manifest.json'), 'utf8'));

  it('lists a public-domain beginner and intermediate set, including BWV 846', () => {
    expect(manifest.length).toBeGreaterThanOrEqual(30);
    expect(manifest.length).toBeLessThanOrEqual(45);
    const prelude = manifest.find(entry => entry.id === 'bwv-846-prelude');
    expect(prelude).toMatchObject({
      title: 'Prelude in C major, BWV 846',
      composer: 'Johann Sebastian Bach',
      license: 'Public Domain'
    });
    manifest.forEach(entry => {
      expect(entry.license, entry.id).toBeTruthy();
      expect(entry.source, entry.id).toMatch(/^https:\/\//);
      expect(entry.licenseUrl, entry.id).toMatch(/^https?:\/\//);
      expect(fs.existsSync(path.join(root, entry.file)), entry.file).toBe(true);
    });
  });

  it('imports every score into contiguous bars and playable notes', () => {
    manifest.forEach(entry => {
      const xml = fs.readFileSync(path.join(root, entry.file), 'utf8');
      const piece = api.parse(xml, entry.file);
      expect(piece.notes.length, entry.id).toBeGreaterThan(0);
      expect(piece.bars.length, entry.id).toBeGreaterThan(0);
      expect(piece.bars[0].start, entry.id).toBe(0);
      expect(piece.tempo, entry.id).toBeGreaterThanOrEqual(30);
      expect(piece.tempo, entry.id).toBeLessThanOrEqual(240);

      piece.bars.forEach((bar, index) => {
        expect(bar.end, `${entry.id} bar ${index}`).toBeGreaterThan(bar.start);
        if (index > 0)
          expect(bar.start, `${entry.id} bar ${index}`).toBe(piece.bars[index - 1].end);
        expect(bar.beats, entry.id).toBeGreaterThan(0);
        expect(bar.beatType, entry.id).toBeGreaterThan(0);
      });

      const end = piece.bars[piece.bars.length - 1].end;
      piece.notes.forEach(note => {
        expect(note.pitch, entry.id).toMatch(PITCH);
        expect(['left', 'right']).toContain(note.hand);
        expect(note.duration, entry.id).toBeGreaterThan(0);
        expect(note.start, entry.id).toBeGreaterThanOrEqual(0);
        expect(note.start, entry.id).toBeLessThanOrEqual(end + 0.001);
        expect(note.start + note.duration, entry.id).toBeLessThanOrEqual(end + 0.05);
      });
    });
  });

  it('keeps the C major prelude in 4/4 and spells B-flat', () => {
    const xml = fs.readFileSync(path.join(root, 'library/scores/bwv-846-prelude.musicxml'), 'utf8');
    const piece = api.parse(xml, 'bwv-846-prelude.musicxml');
    expect(piece.key).toBe('C major');
    expect(
      piece.bars.every(bar => bar.beats === 4 && bar.beatType === 4 && bar.end - bar.start === 4)
    ).toBe(true);
    expect(piece.notes.some(note => note.pitch === 'Bb3' || note.pitch === 'Bb4')).toBe(true);
    expect(piece.notes.some(note => note.pitch.startsWith('A#'))).toBe(false);
    expect(piece.notes.length).toBeGreaterThan(400);
    expect(xml).toContain('<type>16th</type>');
    expect(xml).toContain('<key><fifths>0</fifths><mode>major</mode></key>');
    const measures = xml.match(/<measure\b[^>]*>[\s\S]*?<\/measure>/g) || [];
    measures.forEach(measure => {
      const stavesByVoice = new Map();
      const notes = measure.match(/<note>[\s\S]*?<\/note>/g) || [];
      notes.forEach(note => {
        const voice = note.match(/<voice>(\d+)<\/voice>/)?.[1] || '1';
        const staff = note.match(/<staff>(\d+)<\/staff>/)?.[1] || '1';
        if (!stavesByVoice.has(voice)) stavesByVoice.set(voice, new Set());
        stavesByVoice.get(voice).add(staff);
      });
      stavesByVoice.forEach(staves => {
        expect(staves.size).toBe(1);
      });
    });
  });

  it('keeps the Für Elise pickup shorter than a full bar', () => {
    const xml = fs.readFileSync(
      path.join(root, 'library/scores/beethoven-fur-elise.musicxml'),
      'utf8'
    );
    const piece = api.parse(xml, 'beethoven-fur-elise.musicxml');
    expect(piece.tempo).toBe(72);
    expect(piece.bars[0].implicit).toBe(true);
    expect(piece.bars[0].number).toBeNull();
    expect(piece.bars[0].end - piece.bars[0].start).toBeLessThan(
      piece.bars[1].end - piece.bars[1].start
    );
    expect(piece.notes[0].start).toBe(0);
  });
});
