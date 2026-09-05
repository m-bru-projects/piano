(() => {
  const pieces = window.PIANO_PIECES;
  const pieceSelect = document.getElementById('pieceSelect');
  if (!Array.isArray(pieces) || !pieceSelect) return;

  const KEY_NAMES = {
    '-7': 'Cb major', '-6': 'Gb major', '-5': 'Db major', '-4': 'Ab major',
    '-3': 'Eb major', '-2': 'Bb major', '-1': 'F major', '0': 'C major',
    '1': 'G major', '2': 'D major', '3': 'A major', '4': 'E major',
    '5': 'B major', '6': 'F# major', '7': 'C# major'
  };
  const MINOR_KEY_NAMES = {
    '-7': 'Ab minor', '-6': 'Eb minor', '-5': 'Bb minor', '-4': 'F minor',
    '-3': 'C minor', '-2': 'G minor', '-1': 'D minor', '0': 'A minor',
    '1': 'E minor', '2': 'B minor', '3': 'F# minor', '4': 'C# minor',
    '5': 'G# minor', '6': 'D# minor', '7': 'A# minor'
  };
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function directChildren(node, tagName) {
    return [...node.children].filter(child => child.localName === tagName);
  }

  function firstDirect(node, tagName) {
    return directChildren(node, tagName)[0] || null;
  }

  function text(node, selector, fallback = '') {
    const found = node.querySelector(selector);
    return found?.textContent?.trim() || fallback;
  }

  function numberText(node, selector, fallback = 0) {
    const value = Number(text(node, selector, ''));
    return Number.isFinite(value) ? value : fallback;
  }

  function slugify(value) {
    return (value || 'imported-piece')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'imported-piece';
  }

  function pitchFromMusicXml(note) {
    const pitch = firstDirect(note, 'pitch');
    if (!pitch) return null;
    const step = text(pitch, 'step');
    const octave = Number(text(pitch, 'octave'));
    const alter = Number(text(pitch, 'alter', '0')) || 0;
    if (!/^[A-G]$/.test(step) || !Number.isFinite(octave)) return null;

    if (alter === 0) return `${step}${octave}`;
    if (alter === 1) return `${step}#${octave}`;
    if (alter === -1) return `${step}b${octave}`;

    // The prototype renderer supports one accidental. Normalize unusual
    // accidentals/microtones to the nearest chromatic pitch instead of failing.
    const naturalSemitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step];
    const midi = Math.round((octave + 1) * 12 + naturalSemitone + alter);
    const normalizedOctave = Math.floor(midi / 12) - 1;
    const name = SHARP_NAMES[((midi % 12) + 12) % 12];
    return `${name}${normalizedOctave}`;
  }

  function handForNote(note, pitch) {
    const staff = Number(text(note, 'staff', '0'));
    if (staff === 1) return 'right';
    if (staff >= 2) return 'left';
    const octave = Number((pitch.match(/(-?\d+)$/) || [])[1]);
    const letter = pitch[0];
    if (!Number.isFinite(octave)) return 'right';
    if (octave < 4) return 'left';
    if (octave > 4) return 'right';
    return ['C', 'D'].includes(letter) ? 'left' : 'right';
  }

  function fingeringForNote(note) {
    const raw = text(note, 'notations technical fingering');
    const finger = Number(raw);
    return Number.isInteger(finger) && finger >= 1 && finger <= 5 ? finger : undefined;
  }

  function readTempo(doc) {
    const sound = [...doc.querySelectorAll('sound[tempo]')]
      .map(node => Number(node.getAttribute('tempo')))
      .find(value => Number.isFinite(value) && value > 0);
    if (sound) return Math.round(sound);

    const perMinute = [...doc.querySelectorAll('metronome per-minute')]
      .map(node => Number(node.textContent))
      .find(value => Number.isFinite(value) && value > 0);
    return perMinute ? Math.round(perMinute) : 90;
  }

  function readTitle(doc, filename) {
    return text(doc, 'work > work-title') ||
      text(doc, 'movement-title') ||
      filename.replace(/\.(musicxml|xml|mxl)$/i, '') ||
      'Imported MusicXML';
  }

  function readComposer(doc) {
    const typed = [...doc.querySelectorAll('identification creator')]
      .find(node => (node.getAttribute('type') || '').toLowerCase() === 'composer');
    return typed?.textContent?.trim() || text(doc, 'identification creator', 'Unknown composer');
  }

  function parseMusicXml(xmlText, filename = 'Imported MusicXML') {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) throw new Error('Dit bestand bevat geen geldige MusicXML.');

    const root = doc.documentElement;
    if (!root || !['score-partwise', 'score-timewise'].includes(root.localName)) {
      throw new Error('Geen MusicXML score gevonden. Verwacht score-partwise of score-timewise.');
    }
    if (root.localName === 'score-timewise') {
      throw new Error('score-timewise MusicXML wordt nog niet ondersteund. Exporteer als score-partwise.');
    }

    let timeSignature = [4, 4];
    let key = 'C major';
    let initialTimeRead = false;
    let initialKeyRead = false;
    const notes = [];
    const parts = directChildren(root, 'part');

    if (!parts.length) throw new Error('De MusicXML bevat geen partijen.');

    parts.forEach(part => {
      let divisions = 1;
      let measureStart = 0;
      let currentTime = [...timeSignature];

      directChildren(part, 'measure').forEach(measure => {
        let cursor = 0;
        let lastChordStart = 0;
        let maxEnd = 0;

        for (const child of measure.children) {
          if (child.localName === 'attributes') {
            const div = numberText(child, 'divisions', divisions);
            if (div > 0) divisions = div;

            const beats = numberText(child, 'time beats', currentTime[0]);
            const beatType = numberText(child, 'time beat-type', currentTime[1]);
            if (beats > 0 && beatType > 0) {
              currentTime = [beats, beatType];
              if (!initialTimeRead) {
                timeSignature = [...currentTime];
                initialTimeRead = true;
              }
            }

            const fifthsNode = child.querySelector('key fifths');
            if (fifthsNode && !initialKeyRead) {
              const fifths = Number(fifthsNode.textContent);
              const mode = text(child, 'key mode', 'major').toLowerCase();
              const map = mode === 'minor' ? MINOR_KEY_NAMES : KEY_NAMES;
              key = map[String(fifths)] || `${fifths} fifths ${mode}`;
              initialKeyRead = true;
            }
            continue;
          }

          if (child.localName === 'backup') {
            cursor = Math.max(0, cursor - numberText(child, 'duration', 0));
            continue;
          }

          if (child.localName === 'forward') {
            cursor += numberText(child, 'duration', 0);
            maxEnd = Math.max(maxEnd, cursor);
            continue;
          }

          if (child.localName !== 'note') continue;

          const durationDiv = numberText(child, 'duration', 0);
          const isChord = Boolean(firstDirect(child, 'chord'));
          const isGrace = Boolean(firstDirect(child, 'grace'));
          const startDiv = isChord ? lastChordStart : cursor;
          if (!isChord) lastChordStart = startDiv;

          const durationBeats = durationDiv > 0 ? durationDiv / divisions : (isGrace ? 0.125 : 0);
          const startBeats = measureStart + startDiv / divisions;
          const pitch = pitchFromMusicXml(child);
          const isRest = Boolean(firstDirect(child, 'rest'));

          if (!isRest && pitch && durationBeats > 0) {
            const item = {
              pitch,
              start: Number(startBeats.toFixed(6)),
              duration: Number(durationBeats.toFixed(6)),
              hand: handForNote(child, pitch)
            };
            const finger = fingeringForNote(child);
            if (finger) item.finger = finger;
            notes.push(item);
          }

          if (!isChord && !isGrace) cursor += durationDiv;
          maxEnd = Math.max(maxEnd, startDiv + (isGrace ? 0 : durationDiv), cursor);
        }

        const actualMeasureBeats = maxEnd / divisions;
        const expectedQuarterBeats = currentTime[0] * (4 / currentTime[1]);
        const isImplicit = measure.getAttribute('implicit') === 'yes';
        const advance = isImplicit
          ? (actualMeasureBeats || expectedQuarterBeats)
          : Math.max(actualMeasureBeats, expectedQuarterBeats || 0);
        measureStart += advance || expectedQuarterBeats || 4;
      });
    });

    if (!notes.length) throw new Error('Er werden geen speelbare noten gevonden in dit MusicXML-bestand.');

    notes.sort((a, b) => a.start - b.start || a.pitch.localeCompare(b.pitch));
    const title = readTitle(doc, filename);
    const composer = readComposer(doc);
    const idBase = `import-${slugify(title)}`;
    let id = idBase;
    let suffix = 2;
    while (pieces.some(piece => piece.id === id)) id = `${idBase}-${suffix++}`;

    const fingerCount = notes.filter(note => note.finger).length;
    return {
      id,
      title,
      composer,
      key,
      timeSignature,
      tempo: Math.min(240, Math.max(30, readTempo(doc))),
      level: 'Imported',
      description: `Imported from ${filename} · ${notes.length} notes${fingerCount ? ` · ${fingerCount} fingerings` : ''}`,
      notes
    };
  }

  function readUInt16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readUInt32(view, offset) {
    return view.getUint32(offset, true);
  }

  function decodeUtf8(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('.mxl uitpakken wordt niet ondersteund door deze browser. Gebruik .musicxml/.xml.');
    }
    let stream;
    try {
      stream = new DecompressionStream('deflate-raw');
    } catch {
      throw new Error('.mxl uitpakken wordt niet ondersteund door deze browser. Gebruik .musicxml/.xml.');
    }
    const decompressed = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(decompressed).arrayBuffer());
  }

  function findEocd(view) {
    const min = Math.max(0, view.byteLength - 65557);
    for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
      if (readUInt32(view, offset) === 0x06054b50) return offset;
    }
    return -1;
  }

  async function unzipEntries(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const eocd = findEocd(view);
    if (eocd < 0) throw new Error('Ongeldig .mxl/ZIP-bestand.');

    const entryCount = readUInt16(view, eocd + 10);
    const centralOffset = readUInt32(view, eocd + 16);
    let offset = centralOffset;
    const entries = new Map();

    for (let index = 0; index < entryCount; index += 1) {
      if (readUInt32(view, offset) !== 0x02014b50) throw new Error('Beschadigde .mxl central directory.');
      const method = readUInt16(view, offset + 10);
      const compressedSize = readUInt32(view, offset + 20);
      const fileNameLength = readUInt16(view, offset + 28);
      const extraLength = readUInt16(view, offset + 30);
      const commentLength = readUInt16(view, offset + 32);
      const localOffset = readUInt32(view, offset + 42);
      const fileName = decodeUtf8(bytes.slice(offset + 46, offset + 46 + fileNameLength));

      if (readUInt32(view, localOffset) !== 0x04034b50) throw new Error('Beschadigde .mxl local header.');
      const localNameLength = readUInt16(view, localOffset + 26);
      const localExtraLength = readUInt16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);

      if (!fileName.endsWith('/')) {
        let data;
        if (method === 0) data = compressed;
        else if (method === 8) data = await inflateRaw(compressed);
        else throw new Error(`Niet-ondersteunde .mxl compressiemethode (${method}).`);
        entries.set(fileName.replace(/^\.\//, ''), data);
      }

      offset += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function musicXmlTextFromFile(file) {
    if (!/\.mxl$/i.test(file.name)) return file.text();

    const entries = await unzipEntries(await file.arrayBuffer());
    let rootPath = '';
    const container = entries.get('META-INF/container.xml');
    if (container) {
      const containerDoc = new DOMParser().parseFromString(decodeUtf8(container), 'application/xml');
      rootPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path') || '';
    }

    const fallback = [...entries.keys()].find(name => /\.(musicxml|xml)$/i.test(name) && !/META-INF\//i.test(name));
    const target = rootPath && entries.has(rootPath) ? rootPath : fallback;
    if (!target) throw new Error('Geen MusicXML-score gevonden in het .mxl-bestand.');
    return decodeUtf8(entries.get(target));
  }

  function addPieceOption(piece) {
    const option = document.createElement('option');
    option.value = piece.id;
    option.textContent = `${piece.title} — ${piece.composer}`;
    option.dataset.imported = 'true';
    pieceSelect.appendChild(option);
    pieceSelect.value = piece.id;
    pieceSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function createImportUi() {
    const picker = pieceSelect.closest('.piece-picker') || pieceSelect.parentElement;
    const controls = document.createElement('div');
    controls.className = 'musicxml-import';
    controls.innerHTML = `
      <input id="musicXmlFile" type="file" accept=".musicxml,.xml,.mxl,application/xml,text/xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml" hidden>
      <button id="musicXmlButton" type="button" class="musicxml-button" title="Import MusicXML from your computer">Import MusicXML</button>
      <span id="musicXmlStatus" class="musicxml-status" role="status" aria-live="polite"></span>
    `;
    picker.appendChild(controls);

    const style = document.createElement('style');
    style.textContent = `
      .musicxml-import{display:flex;align-items:center;gap:8px;min-width:0}
      .musicxml-button{appearance:none;border:1px solid #d5d0c6;background:#fffdf8;color:#282621;border-radius:9px;padding:9px 12px;font:700 12px/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap}
      .musicxml-button:hover{background:#f3efe6}.musicxml-button:disabled{opacity:.55;cursor:wait}
      .musicxml-status{font:600 11px/1.25 system-ui,sans-serif;color:#77736b;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .musicxml-status.is-error{color:#a43c32}
      @media(max-width:760px){.musicxml-import{width:100%}.musicxml-status{max-width:150px}.piece-picker{flex-wrap:wrap}}
    `;
    document.head.appendChild(style);

    const input = controls.querySelector('#musicXmlFile');
    const button = controls.querySelector('#musicXmlButton');
    const status = controls.querySelector('#musicXmlStatus');

    button.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      button.disabled = true;
      status.classList.remove('is-error');
      status.textContent = 'Importing…';
      try {
        const xml = await musicXmlTextFromFile(file);
        const piece = parseMusicXml(xml, file.name);
        pieces.push(piece);
        addPieceOption(piece);
        status.textContent = `${piece.notes.length} notes imported`;
      } catch (error) {
        console.error(error);
        status.classList.add('is-error');
        status.textContent = error?.message || 'Import failed';
      } finally {
        button.disabled = false;
        input.value = '';
      }
    });
  }

  window.PianoMusicXML = { parse: parseMusicXml };
  createImportUi();
})();
