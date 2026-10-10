import fs from 'node:fs';
import path from 'node:path';
import { loadImporter, noteElement, root, score } from './helpers.js';

const api = loadImporter();

describe('pitch parsing', () => {
  it('keeps naturals, sharps and flats', () => {
    expect(
      api.pitchFromMusicXml(noteElement('<pitch><step>C</step><octave>4</octave></pitch>'))
    ).toBe('C4');
    expect(
      api.pitchFromMusicXml(
        noteElement('<pitch><step>C</step><alter>1</alter><octave>4</octave></pitch>')
      )
    ).toBe('C#4');
    expect(
      api.pitchFromMusicXml(
        noteElement('<pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch>')
      )
    ).toBe('Bb4');
  });

  it('normalises double accidentals to the nearest chromatic pitch', () => {
    expect(
      api.pitchFromMusicXml(
        noteElement('<pitch><step>C</step><alter>2</alter><octave>4</octave></pitch>')
      )
    ).toBe('D4');
    expect(
      api.pitchFromMusicXml(
        noteElement('<pitch><step>C</step><alter>-2</alter><octave>4</octave></pitch>')
      )
    ).toBe('A#3');
  });

  it('ignores notes without a pitch', () => {
    expect(api.pitchFromMusicXml(noteElement('<rest/>'))).toBeNull();
  });
});

describe('MusicXML import', () => {
  it('reads chords, backup, forward, staff hands and fingerings', () => {
    const piece = api.parse(
      score(`
        <measure number="1">
          <attributes>
            <divisions>1</divisions>
            <key><fifths>0</fifths><mode>major</mode></key>
            <time><beats>4</beats><beat-type>4</beat-type></time>
          </attributes>
          <direction><sound tempo="96"/></direction>
          <note>
            <pitch><step>C</step><octave>4</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
            <notations><technical><fingering>1</fingering></technical></notations>
          </note>
          <note>
            <chord/>
            <pitch><step>E</step><octave>4</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
            <notations><technical><fingering>3</fingering></technical></notations>
          </note>
          <note>
            <pitch><step>G</step><octave>4</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
          </note>
          <forward><duration>1</duration></forward>
          <note>
            <pitch><step>C</step><octave>5</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
          </note>
          <backup><duration>4</duration></backup>
          <note>
            <pitch><step>C</step><octave>3</octave></pitch>
            <duration>4</duration><voice>2</voice><staff>2</staff>
            <notations><technical><fingering>5</fingering></technical></notations>
          </note>
        </measure>
      `),
      'chords.musicxml'
    );

    const chord = piece.notes.filter(note => note.start === 0 && note.hand === 'right');
    expect(chord.map(note => note.pitch).sort()).toEqual(['C4', 'E4']);
    expect(chord.find(note => note.pitch === 'C4').finger).toBe(1);
    expect(piece.notes.find(note => note.pitch === 'G4').start).toBe(1);
    expect(piece.notes.find(note => note.pitch === 'C5').start).toBe(3);
    const bass = piece.notes.find(note => note.pitch === 'C3');
    expect(bass).toMatchObject({ start: 0, duration: 4, hand: 'left', finger: 5 });
    expect(piece.tempo).toBe(96);
    expect(piece.timeSignature).toEqual([4, 4]);
    expect(piece.bars).toEqual([
      { start: 0, end: 4, number: 1, implicit: false, beats: 4, beatType: 4 }
    ]);
  });

  it('uses a 3-quarter bar for 6/8', () => {
    const piece = api.parse(
      score(`
        <measure number="1">
          <attributes>
            <divisions>2</divisions>
            <time><beats>6</beats><beat-type>8</beat-type></time>
          </attributes>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><staff>1</staff></note>
          <note><pitch><step>E</step><octave>4</octave></pitch><duration>3</duration><staff>1</staff></note>
        </measure>
        <measure number="2">
          <note><pitch><step>G</step><octave>4</octave></pitch><duration>6</duration><staff>1</staff></note>
        </measure>
      `)
    );

    expect(piece.timeSignature).toEqual([6, 8]);
    expect(
      piece.bars.map(bar => [bar.start, bar.end, bar.number, bar.beats, bar.beatType])
    ).toEqual([
      [0, 3, 1, 6, 8],
      [3, 6, 2, 6, 8]
    ]);
    expect(piece.notes.find(note => note.pitch === 'E4').start).toBe(1.5);
    expect(piece.notes.find(note => note.pitch === 'G4').start).toBe(3);
  });

  it('shortens a pickup bar and follows a later time-signature change', () => {
    const piece = api.parse(
      score(`
        <measure number="0" implicit="yes">
          <attributes>
            <divisions>1</divisions>
            <time><beats>3</beats><beat-type>4</beat-type></time>
          </attributes>
          <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><staff>1</staff></note>
        </measure>
        <measure number="1">
          <note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration><staff>1</staff></note>
        </measure>
        <measure number="2">
          <attributes>
            <time><beats>6</beats><beat-type>8</beat-type></time>
          </attributes>
          <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><staff>1</staff></note>
        </measure>
      `)
    );

    expect(piece.bars).toEqual([
      { start: 0, end: 1, number: null, implicit: true, beats: 3, beatType: 4 },
      { start: 1, end: 4, number: 1, implicit: false, beats: 3, beatType: 4 },
      { start: 4, end: 7, number: 2, implicit: false, beats: 6, beatType: 8 }
    ]);
    expect(piece.notes.map(note => [note.pitch, note.start, note.duration])).toEqual([
      ['E5', 0, 1],
      ['C5', 1, 3],
      ['G4', 4, 3]
    ]);
  });

  it('merges tied notes and still keeps the bar length', () => {
    const piece = api.parse(
      score(`
        <measure number="1">
          <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          <note>
            <pitch><step>C</step><octave>4</octave></pitch>
            <duration>4</duration><staff>1</staff><voice>1</voice>
            <tie type="start"/>
          </note>
        </measure>
        <measure number="2">
          <note>
            <pitch><step>C</step><octave>4</octave></pitch>
            <duration>2</duration><staff>1</staff><voice>1</voice>
            <tie type="stop"/>
          </note>
          <note>
            <pitch><step>D</step><octave>4</octave></pitch>
            <duration>2</duration><staff>1</staff><voice>1</voice>
          </note>
        </measure>
      `)
    );

    expect(piece.notes.filter(note => note.pitch === 'C4')).toEqual([
      { pitch: 'C4', start: 0, duration: 6, hand: 'right' }
    ]);
    expect(piece.notes.find(note => note.pitch === 'D4').start).toBe(6);
    expect(piece.bars.map(bar => bar.end)).toEqual([4, 8]);
  });

  it('skips cue notes and does not let grace notes move the cursor', () => {
    const piece = api.parse(
      score(`
        <measure number="1">
          <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          <note><cue/><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><staff>1</staff></note>
          <note><grace/><pitch><step>D</step><octave>4</octave></pitch><staff>1</staff></note>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
        </measure>
      `)
    );

    expect(piece.notes.map(note => note.pitch).sort()).toEqual(['C4', 'D4']);
    expect(piece.notes.find(note => note.pitch === 'C4').start).toBe(0);
    expect(piece.notes.find(note => note.pitch === 'D4')).toMatchObject({
      start: 0,
      duration: 0.125
    });
    expect(piece.bars[0].end).toBe(4);
  });

  it('reads a default-namespaced score', () => {
    const piece = api.parse(
      score(
        `
        <measure number="1">
          <attributes>
            <divisions>1</divisions>
            <time><beats>4</beats><beat-type>4</beat-type></time>
          </attributes>
          <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration></note>
        </measure>
      `,
        { xmlns: 'http://www.musicxml.org/ns/musicxml' }
      )
    );
    expect(piece.notes[0]).toMatchObject({ pitch: 'F#4', start: 0, duration: 4 });
  });

  it('clamps tempo to the same 30–240 range as the slider', () => {
    const slow = api.parse(
      score(`
        <measure number="1">
          <attributes><divisions>1</divisions></attributes>
          <direction><sound tempo="20"/></direction>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
        </measure>
      `)
    );
    const fast = api.parse(
      score(`
        <measure number="1">
          <attributes><divisions>1</divisions></attributes>
          <direction><sound tempo="400"/></direction>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
        </measure>
      `)
    );
    expect(slow.tempo).toBe(30);
    expect(fast.tempo).toBe(240);
  });

  it('parses the bundled import sample', () => {
    const xml = fs.readFileSync(path.join(root, 'samples/import-test.musicxml'), 'utf8');
    const piece = api.parse(xml, 'import-test.musicxml');
    expect(piece.notes.map(note => [note.pitch, note.start, note.hand])).toEqual([
      ['C3', 0, 'left'],
      ['C4', 0, 'right'],
      ['E4', 0, 'right'],
      ['D4', 1, 'right'],
      ['E4', 2, 'right'],
      ['G2', 2, 'left'],
      ['F4', 3, 'right']
    ]);
    expect(piece.tempo).toBe(96);
  });

  it('reports problems in English', () => {
    expect(() => api.parse('<<<')).toThrow(/valid MusicXML/);
    expect(() => api.parse('<foo/>')).toThrow(/score-partwise or score-timewise/);
    expect(() => api.parse('<score-timewise version="4.0"></score-timewise>')).toThrow(
      /score-timewise/
    );
    expect(() => api.parse('<score-partwise version="4.0"></score-partwise>')).toThrow(/no parts/);
    expect(() =>
      api.parse(
        score(`
          <measure number="1">
            <note><rest/><duration>4</duration></note>
          </measure>
        `)
      )
    ).toThrow(/No playable notes/);

    const source = fs.readFileSync(path.join(root, 'musicxml-import.js'), 'utf8');
    ['ongeldig', 'geen ', 'niet ', 'bestand', 'fout', 'archief', 'ondersteund'].forEach(word => {
      expect(source.toLowerCase()).not.toContain(word);
    });
  });
});
