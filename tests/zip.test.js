import { TextDecoder } from 'node:util';
import { loadImporter } from './helpers.js';
import { makeZip } from './zip.js';

const api = loadImporter();
const decoder = new TextDecoder();

const SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Zipped</work-title></work>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

describe('ZIP reader', () => {
  it('reads stored and deflated MusicXML entries', async () => {
    for (const method of [0, 8]) {
      const archive = makeZip([{ name: 'score.musicxml', data: SCORE, method }]);
      const entries = await api.unzipEntries(archive);
      expect(decoder.decode(entries.get('score.musicxml'))).toContain(
        '<work-title>Zipped</work-title>'
      );
      const piece = api.parse(decoder.decode(entries.get('score.musicxml')), 'score.musicxml');
      expect(piece.notes[0].pitch).toBe('A4');
    }
  });

  it('rejects archives that exceed the file count, size, path or ZIP64 limits', async () => {
    const many = Array.from({ length: 257 }, (_, index) => ({
      name: `f${index}.xml`,
      data: '<x/>'
    }));
    await expect(api.unzipEntries(makeZip(many))).rejects.toThrow(/too many files/);

    await expect(
      api.unzipEntries(
        makeZip([
          {
            name: 'big.xml',
            data: '<x/>',
            uncompressedSize: 32 * 1024 * 1024 + 1
          }
        ])
      )
    ).rejects.toThrow(/too large/);

    await expect(
      api.unzipEntries(makeZip([{ name: '../secret.xml', data: '<x/>' }]))
    ).rejects.toThrow(/unsafe path/);

    await expect(
      api.unzipEntries(makeZip([{ name: 'zip64.xml', data: '<x/>', compressedSize: 0xffffffff }]))
    ).rejects.toThrow(/ZIP64/);

    await expect(api.unzipEntries(new ArrayBuffer(8))).rejects.toThrow(/Invalid \.mxl\/ZIP file/);
  });
});
