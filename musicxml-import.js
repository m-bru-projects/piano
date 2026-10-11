(() => {
  const KEY_NAMES = {
    '-7': 'Cb major',
    '-6': 'Gb major',
    '-5': 'Db major',
    '-4': 'Ab major',
    '-3': 'Eb major',
    '-2': 'Bb major',
    '-1': 'F major',
    0: 'C major',
    1: 'G major',
    2: 'D major',
    3: 'A major',
    4: 'E major',
    5: 'B major',
    6: 'F# major',
    7: 'C# major'
  };
  const MINOR_KEY_NAMES = {
    '-7': 'Ab minor',
    '-6': 'Eb minor',
    '-5': 'Bb minor',
    '-4': 'F minor',
    '-3': 'C minor',
    '-2': 'G minor',
    '-1': 'D minor',
    0: 'A minor',
    1: 'E minor',
    2: 'B minor',
    3: 'F# minor',
    4: 'C# minor',
    5: 'G# minor',
    6: 'D# minor',
    7: 'A# minor'
  };
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const DB_NAME = 'piano-library';
  const DB_STORE = 'imports';
  const ZIP_LIMITS = {
    maxEntries: 256,
    maxArchiveBytes: 64 * 1024 * 1024,
    maxCompressedBytes: 32 * 1024 * 1024,
    maxUncompressedBytes: 32 * 1024 * 1024,
    maxTotalUncompressedBytes: 64 * 1024 * 1024
  };

  function elementsInOrder(node, direct) {
    if (!node) return [];
    if (direct) return [...node.children];
    const found = [];
    const stack = [...node.children].reverse();
    while (stack.length) {
      const current = stack.pop();
      found.push(current);
      const children = current.children;
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    }
    return found;
  }

  function localQuery(root, selector) {
    if (!root || !selector) return null;
    const tokens = selector.trim().split(/\s+/);
    let current = [root];
    let direct = false;
    for (const token of tokens) {
      if (token === '>') {
        direct = true;
        continue;
      }
      const next = [];
      current.forEach(node => {
        elementsInOrder(node, direct).forEach(element => {
          if (element.localName === token) next.push(element);
        });
      });
      current = next;
      direct = false;
      if (!current.length) return null;
    }
    return current[0];
  }

  function directChildren(node, tagName) {
    return [...node.children].filter(child => child.localName === tagName);
  }

  function firstDirect(node, tagName) {
    return directChildren(node, tagName)[0] || null;
  }

  function text(node, selector, fallback = '') {
    const found = node ? localQuery(node, selector) : null;
    const value = found?.textContent?.trim();
    return value || fallback;
  }

  function numberText(node, selector, fallback = 0) {
    const found = node ? localQuery(node, selector) : null;
    if (!found) return fallback;
    const value = Number(found.textContent);
    return Number.isFinite(value) ? value : fallback;
  }

  function roundBeats(value) {
    return Number(value.toFixed(6));
  }

  function knownPieces() {
    return Array.isArray(globalThis.PIANO_PIECES) ? globalThis.PIANO_PIECES : [];
  }

  function slugify(value) {
    return (
      (value || 'imported-piece')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'imported-piece'
    );
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

    const naturalSemitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step];
    const midi = Math.round((octave + 1) * 12 + naturalSemitone + alter);
    const normalizedOctave = Math.floor(midi / 12) - 1;
    const name = SHARP_NAMES[((midi % 12) + 12) % 12];
    return `${name}${normalizedOctave}`;
  }

  function handForNote(note, pitch) {
    const staffText = text(note, 'staff', '');
    const staff = Number(staffText);
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

  function tieTypes(note) {
    const types = new Set();
    elementsInOrder(note, false).forEach(element => {
      if (element.localName !== 'tie' && element.localName !== 'tied') return;
      const type = element.getAttribute('type');
      if (type) types.add(type);
    });
    return types;
  }

  function readTempo(doc) {
    const sound = elementsInOrder(doc.documentElement, false)
      .filter(node => node.localName === 'sound' && node.hasAttribute('tempo'))
      .map(node => Number(node.getAttribute('tempo')))
      .find(value => Number.isFinite(value) && value > 0);
    if (sound) return Math.round(sound);

    const perMinute = elementsInOrder(doc.documentElement, false)
      .filter(node => node.localName === 'per-minute')
      .map(node => Number(node.textContent))
      .find(value => Number.isFinite(value) && value > 0);
    return perMinute ? Math.round(perMinute) : 90;
  }

  function readTitle(doc, filename) {
    return (
      text(doc, 'work work-title') ||
      text(doc, 'movement-title') ||
      filename.replace(/\.(musicxml|xml|mxl)$/i, '') ||
      'Imported MusicXML'
    );
  }

  function readComposer(doc) {
    const creators = elementsInOrder(doc.documentElement, false).filter(
      node => node.localName === 'creator'
    );
    const typed = creators.find(
      node => (node.getAttribute('type') || '').toLowerCase() === 'composer'
    );
    return typed?.textContent?.trim() || creators[0]?.textContent?.trim() || 'Unknown composer';
  }

  function keyName(fifths, mode) {
    const map = mode === 'minor' ? MINOR_KEY_NAMES : KEY_NAMES;
    return map[String(fifths)] || `${fifths} fifths ${mode}`;
  }

  function quarterLength(beats, beatType) {
    if (!(beats > 0) || !(beatType > 0)) return 0;
    return beats * (4 / beatType);
  }

  function parsePart(part, openTies) {
    let divisions = 1;
    let currentTime = [4, 4];
    let key = null;
    const measures = [];

    directChildren(part, 'measure').forEach(measure => {
      let cursorQ = 0;
      let lastChordStartQ = 0;
      let maxEndQ = 0;
      let measureTime = null;
      const notes = [];

      for (const child of measure.children) {
        if (child.localName === 'attributes') {
          const div = numberText(child, 'divisions', divisions);
          if (div > 0) divisions = div;
          const timeNode = localQuery(child, 'time');
          if (timeNode) {
            const beats = numberText(timeNode, 'beats', 0);
            const beatType = numberText(timeNode, 'beat-type', 0);
            if (beats > 0 && beatType > 0) {
              currentTime = [beats, beatType];
              measureTime = [beats, beatType];
            }
          }
          const fifthsNode = localQuery(child, 'key fifths');
          if (fifthsNode && !key) {
            const fifths = Number(fifthsNode.textContent);
            const mode = text(child, 'key mode', 'major').toLowerCase();
            if (Number.isFinite(fifths)) key = keyName(fifths, mode);
          }
          continue;
        }

        if (child.localName === 'backup') {
          const durationDiv = numberText(child, 'duration', 0);
          cursorQ = Math.max(0, cursorQ - durationDiv / divisions);
          continue;
        }

        if (child.localName === 'forward') {
          const durationDiv = numberText(child, 'duration', 0);
          cursorQ += durationDiv / divisions;
          maxEndQ = Math.max(maxEndQ, cursorQ);
          continue;
        }

        if (child.localName !== 'note') continue;
        if (firstDirect(child, 'cue')) continue;

        const isChord = Boolean(firstDirect(child, 'chord'));
        const isGrace = Boolean(firstDirect(child, 'grace'));
        const rest = firstDirect(child, 'rest');
        const isRest = Boolean(rest);
        const durationDiv = numberText(child, 'duration', 0);
        let durationQ = durationDiv > 0 ? durationDiv / divisions : 0;
        if (isRest && rest.getAttribute('measure') === 'yes' && durationQ <= 0) {
          durationQ = quarterLength(currentTime[0], currentTime[1]);
        }
        if (isGrace && durationQ <= 0) durationQ = 0.125;

        const startQ = isChord ? lastChordStartQ : cursorQ;
        if (!isChord) lastChordStartQ = startQ;
        const pitch = pitchFromMusicXml(child);
        const ties = tieTypes(child);
        const tieStart = ties.has('start');
        const tieStop = ties.has('stop');
        const staff = text(child, 'staff', '');
        const voice = text(child, 'voice', '1') || '1';

        if (!isRest && pitch && durationQ > 0) {
          const tieKey = `${staff || '0'}|${voice}|${pitch}`;
          const previous = tieStop ? openTies.get(tieKey) : null;
          if (previous) {
            previous.duration += durationQ;
            if (tieStart) openTies.set(tieKey, previous);
            else openTies.delete(tieKey);
          } else {
            const item = {
              pitch,
              relStart: startQ,
              duration: durationQ,
              hand: handForNote(child, pitch)
            };
            const finger = fingeringForNote(child);
            if (finger) item.finger = finger;
            notes.push(item);
            if (tieStart) openTies.set(tieKey, item);
          }
        }

        if (!isChord && !isGrace) cursorQ += durationQ;
        maxEndQ = Math.max(maxEndQ, startQ + (isGrace ? 0 : durationQ), cursorQ);
      }

      const numberAttr = measure.getAttribute('number');
      measures.push({
        implicit: measure.getAttribute('implicit') === 'yes',
        numberAttr: numberAttr != null && numberAttr !== '' ? numberAttr : null,
        timeSignature: measureTime,
        lengthQuarters: maxEndQ,
        notes
      });
    });

    return { measures, key };
  }

  function parseMusicXml(xmlText, filename = 'Imported MusicXML') {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const root = doc.documentElement;
    if (
      !root ||
      root.localName === 'parsererror' ||
      doc.getElementsByTagName('parsererror').length
    ) {
      throw new Error('This file does not contain valid MusicXML.');
    }
    if (!['score-partwise', 'score-timewise'].includes(root.localName)) {
      throw new Error('No MusicXML score found. Expected score-partwise or score-timewise.');
    }
    if (root.localName === 'score-timewise') {
      throw new Error('score-timewise MusicXML is not supported yet. Export as score-partwise.');
    }

    const partNodes = directChildren(root, 'part');
    if (!partNodes.length) throw new Error('The MusicXML file contains no parts.');

    const parsedParts = partNodes.map(part => parsePart(part, new Map()));
    const measureCount = parsedParts.reduce((max, part) => Math.max(max, part.measures.length), 0);
    const bars = [];
    const notes = [];
    let measureStart = 0;
    let carriedTime = [4, 4];
    let nextNumber = 1;

    for (let index = 0; index < measureCount; index += 1) {
      const measures = parsedParts.map(part => part.measures[index]).filter(Boolean);
      const explicitTime = measures.find(measure => measure.timeSignature);
      if (explicitTime) carriedTime = [...explicitTime.timeSignature];
      const [beats, beatType] = carriedTime;
      const expected = quarterLength(beats, beatType);
      const actual = measures.reduce((max, measure) => Math.max(max, measure.lengthQuarters), 0);
      const implicit = measures.some(measure => measure.implicit);
      const advance =
        (implicit ? actual || expected : Math.max(actual, expected || 0)) || expected || 4;
      let number = null;
      if (!implicit) {
        const attr = measures
          .map(measure => measure.numberAttr)
          .find(value => value != null && /^-?\d+$/.test(value));
        number = attr != null ? Number(attr) : nextNumber;
        nextNumber = number + 1;
      }
      bars.push({
        start: roundBeats(measureStart),
        end: roundBeats(measureStart + advance),
        number,
        implicit,
        beats,
        beatType
      });
      measures.forEach(measure => {
        measure.notes.forEach(note => {
          notes.push({
            ...note,
            start: roundBeats(measureStart + note.relStart),
            duration: roundBeats(note.duration)
          });
        });
      });
      measureStart += advance;
    }

    if (!notes.length) throw new Error('No playable notes were found in this MusicXML file.');

    notes.forEach(note => {
      delete note.relStart;
    });
    notes.sort((a, b) => a.start - b.start || a.pitch.localeCompare(b.pitch));

    const title = readTitle(doc, filename);
    const composer = readComposer(doc);
    const key = parsedParts.find(part => part.key)?.key || 'C major';
    const timeSignature = bars.length ? [bars[0].beats, bars[0].beatType] : [4, 4];
    const idBase = `import-${slugify(title)}`;
    let id = idBase;
    let suffix = 2;
    const pieces = knownPieces();
    while (pieces.some(piece => piece.id === id)) id = `${idBase}-${suffix++}`;
    const fingerCount = notes.filter(note => note.finger).length;

    return {
      id,
      title,
      composer,
      key,
      timeSignature,
      bars,
      tempo: Math.min(240, Math.max(30, readTempo(doc))),
      level: 'Imported',
      description: `Imported from ${filename} · ${notes.length} notes${fingerCount ? ` · ${fingerCount} fingerings` : ''}`,
      notes,
      musicXml: xmlText
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

  function assertInRange(view, offset, length, message) {
    if (offset < 0 || length < 0 || offset + length > view.byteLength) {
      throw new Error(message);
    }
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined' || typeof ReadableStream === 'undefined') {
      throw new Error('.mxl extraction is not supported in this browser. Use .musicxml or .xml.');
    }
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(input);
        controller.close();
      }
    });
    let stream;
    try {
      stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
    } catch {
      throw new Error('.mxl extraction is not supported in this browser. Use .musicxml or .xml.');
    }
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const output = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(chunk => {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return output;
  }

  function findEocd(view) {
    const min = Math.max(0, view.byteLength - 65557);
    for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
      if (readUInt32(view, offset) === 0x06054b50) return offset;
    }
    return -1;
  }

  function safeZipPath(fileName) {
    const normalized = fileName.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error('This .mxl entry has an unsafe path.');
    }
    return normalized;
  }

  async function unzipEntries(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    if (view.byteLength > ZIP_LIMITS.maxArchiveBytes) {
      throw new Error('This .mxl archive is too large.');
    }
    const eocd = findEocd(view);
    if (eocd < 0) throw new Error('Invalid .mxl/ZIP file.');

    const entryCount = readUInt16(view, eocd + 10);
    if (entryCount > ZIP_LIMITS.maxEntries)
      throw new Error('This .mxl archive has too many files.');
    const centralOffset = readUInt32(view, eocd + 16);
    assertInRange(view, centralOffset, 4, 'Invalid .mxl/ZIP file.');
    let offset = centralOffset;
    const entries = new Map();
    let totalUncompressed = 0;

    for (let index = 0; index < entryCount; index += 1) {
      assertInRange(view, offset, 46, 'Corrupt .mxl central directory.');
      if (readUInt32(view, offset) !== 0x02014b50)
        throw new Error('Corrupt .mxl central directory.');
      const method = readUInt16(view, offset + 10);
      const compressedSize = readUInt32(view, offset + 20);
      const uncompressedSize = readUInt32(view, offset + 24);
      const fileNameLength = readUInt16(view, offset + 28);
      const extraLength = readUInt16(view, offset + 30);
      const commentLength = readUInt16(view, offset + 32);
      const localOffset = readUInt32(view, offset + 42);
      assertInRange(view, offset + 46, fileNameLength, 'Corrupt .mxl central directory.');
      const fileName = decodeUtf8(bytes.slice(offset + 46, offset + 46 + fileNameLength));

      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
        throw new Error('ZIP64 .mxl archives are not supported.');
      }
      if (
        compressedSize > ZIP_LIMITS.maxCompressedBytes ||
        uncompressedSize > ZIP_LIMITS.maxUncompressedBytes
      ) {
        throw new Error('This .mxl entry is too large to import.');
      }

      assertInRange(view, localOffset, 30, 'Corrupt .mxl local header.');
      if (readUInt32(view, localOffset) !== 0x04034b50)
        throw new Error('Corrupt .mxl local header.');
      const localNameLength = readUInt16(view, localOffset + 26);
      const localExtraLength = readUInt16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      assertInRange(view, dataStart, compressedSize, 'Corrupt .mxl local header.');
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);

      if (!fileName.endsWith('/')) {
        const safeName = safeZipPath(fileName);
        let data;
        if (method === 0) data = compressed;
        else if (method === 8) data = await inflateRaw(compressed);
        else throw new Error(`Unsupported .mxl compression method (${method}).`);
        if (data.length > ZIP_LIMITS.maxUncompressedBytes) {
          throw new Error('This .mxl entry is too large to import.');
        }
        totalUncompressed += data.length;
        if (totalUncompressed > ZIP_LIMITS.maxTotalUncompressedBytes) {
          throw new Error('This .mxl archive is too large.');
        }
        entries.set(safeName, data);
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
      const containerDoc = new DOMParser().parseFromString(
        decodeUtf8(container),
        'application/xml'
      );
      const rootFile = elementsInOrder(containerDoc.documentElement, false).find(
        node => node.localName === 'rootfile'
      );
      rootPath = rootFile?.getAttribute('full-path') || '';
    }

    const fallback = [...entries.keys()].find(
      name => /\.(musicxml|xml)$/i.test(name) && !/META-INF\//i.test(name)
    );
    const target = rootPath && entries.has(rootPath) ? rootPath : fallback;
    if (!target) throw new Error('No MusicXML score found in the .mxl file.');
    return decodeUtf8(entries.get(target));
  }

  function openImportDb() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE))
          db.createObjectStore(DB_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function loadAllImports() {
    const db = await openImportDb();
    const records = await requestToPromise(
      db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll()
    );
    db.close();
    return Array.isArray(records) ? records : [];
  }

  async function saveImport(piece) {
    const db = await openImportDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(JSON.parse(JSON.stringify(piece)));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function deleteImport(id) {
    const db = await openImportDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  const api = {
    parse: parseMusicXml,
    unzipEntries,
    pitchFromMusicXml,
    saveImport,
    deleteImport,
    loadAllImports
  };
  globalThis.PianoMusicXML = api;

  if (typeof document === 'undefined') return;
  const pieces = knownPieces();
  const pieceSelect = document.getElementById('pieceSelect');
  if (!pieces || !pieceSelect) return;

  function importedGroup() {
    return document.getElementById('importedPieces') || pieceSelect;
  }

  function addPieceOption(piece, { select = true } = {}) {
    const option = document.createElement('option');
    option.value = piece.id;
    option.textContent = `${piece.title} — ${piece.composer}`;
    option.dataset.imported = 'true';
    importedGroup().appendChild(option);
    if (select) {
      pieceSelect.value = piece.id;
      pieceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    updateRemoveButton();
  }

  function selectedImportedPiece() {
    return pieces.find(piece => piece.id === pieceSelect.value && piece.imported) || null;
  }

  function updateRemoveButton() {
    const button = document.getElementById('musicXmlRemove');
    if (!button) return;
    const piece = selectedImportedPiece();
    button.hidden = !piece;
  }

  async function restoreImports() {
    try {
      const saved = await loadAllImports();
      saved.forEach(piece => {
        if (!piece?.id || !Array.isArray(piece.notes) || pieces.some(item => item.id === piece.id))
          return;
        piece.imported = true;
        pieces.push(piece);
        addPieceOption(piece, { select: false });
      });
    } catch (error) {
      console.warn('Could not restore imported pieces', error);
    }
  }

  function createImportUi() {
    const picker = pieceSelect.closest('.piece-picker') || pieceSelect.parentElement;
    const controls = document.createElement('div');
    controls.className = 'musicxml-import';
    controls.innerHTML = `
      <input id="musicXmlFile" type="file" accept=".musicxml,.xml,.mxl,application/xml,text/xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml" hidden>
      <button id="musicXmlButton" type="button" class="musicxml-button" title="Import MusicXML from your computer">Import MusicXML</button>
      <button id="musicXmlRemove" type="button" class="musicxml-button is-danger" hidden>Remove import</button>
      <span id="musicXmlStatus" class="musicxml-status" role="status" aria-live="polite"></span>
    `;
    picker.appendChild(controls);

    const style = document.createElement('style');
    style.textContent = `
      .musicxml-import{display:flex;align-items:center;gap:8px;min-width:0}
      .musicxml-button{appearance:none;border:1px solid #d5d0c6;background:#fffdf8;color:#282621;border-radius:9px;padding:9px 12px;font:700 12px/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap}
      .musicxml-button:hover{background:#f3efe6}.musicxml-button:disabled{opacity:.55;cursor:wait}
      .musicxml-button.is-danger{color:#a43c32}
      .musicxml-status{font:600 11px/1.25 system-ui,sans-serif;color:#77736b;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .musicxml-status.is-error{color:#a43c32}
      @media(max-width:760px){.musicxml-import{width:100%;flex-wrap:wrap}.musicxml-status{max-width:150px}.piece-picker{flex-wrap:wrap}}
    `;
    document.head.appendChild(style);

    const input = controls.querySelector('#musicXmlFile');
    const button = controls.querySelector('#musicXmlButton');
    const removeButton = controls.querySelector('#musicXmlRemove');
    const status = controls.querySelector('#musicXmlStatus');

    button.addEventListener('click', () => input.click());
    pieceSelect.addEventListener('change', updateRemoveButton);
    removeButton.addEventListener('click', async () => {
      const piece = selectedImportedPiece();
      if (!piece) return;
      if (!window.confirm(`Remove “${piece.title}” from this browser?`)) return;
      removeButton.disabled = true;
      try {
        await deleteImport(piece.id);
      } catch (error) {
        console.warn('Could not delete the saved import', error);
      }
      const index = pieces.findIndex(item => item.id === piece.id);
      if (index >= 0) pieces.splice(index, 1);
      pieceSelect.querySelector(`option[value="${piece.id}"]`)?.remove();
      const fallback = pieces[0];
      if (fallback) {
        pieceSelect.value = fallback.id;
        pieceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      status.classList.remove('is-error');
      status.textContent = 'Import removed';
      removeButton.disabled = false;
      updateRemoveButton();
    });

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      button.disabled = true;
      status.classList.remove('is-error');
      status.textContent = 'Importing…';
      try {
        const xml = await musicXmlTextFromFile(file);
        const piece = parseMusicXml(xml, file.name);
        piece.imported = true;
        pieces.push(piece);
        try {
          await saveImport(piece);
        } catch (error) {
          console.warn('Imported piece could not be saved in this browser', error);
        }
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

  createImportUi();
  restoreImports();
})();
