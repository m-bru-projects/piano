(() => {
  const pieces = window.PIANO_PIECES;
  if (!Array.isArray(pieces)) return;

  // The prototype audio engine historically used a compact pitch-class lookup.
  // MusicXML can legitimately spell chromatic notes as B#, E#, Cb or Fb.
  // Normalize only those octave-boundary/enharmonic spellings before an imported
  // piece reaches the render/playback engine, so local MusicXML/MXL files cannot
  // produce NaN oscillator frequencies.
  function normalizePitch(pitch) {
    const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch || '');
    if (!match) return pitch;

    const [, step, accidental, octaveText] = match;
    const octave = Number(octaveText);
    if (!Number.isFinite(octave)) return pitch;

    if (step === 'B' && accidental === '#') return `C${octave + 1}`;
    if (step === 'E' && accidental === '#') return `F${octave}`;
    if (step === 'C' && accidental === 'b') return `B${octave - 1}`;
    if (step === 'F' && accidental === 'b') return `E${octave}`;
    return pitch;
  }

  function normalizePiece(piece) {
    if (!piece || !Array.isArray(piece.notes)) return piece;
    piece.notes.forEach(note => {
      if (note && typeof note.pitch === 'string') note.pitch = normalizePitch(note.pitch);
    });
    return piece;
  }

  // Existing demo pieces are safe, but normalizing them is harmless and makes
  // this utility robust if the bundled data later contains enharmonic spellings.
  pieces.forEach(normalizePiece);

  const nativePush = Array.prototype.push;
  Object.defineProperty(pieces, 'push', {
    configurable: true,
    writable: true,
    value(...items) {
      items.forEach(normalizePiece);
      return nativePush.apply(this, items);
    }
  });

  window.PianoPitchCompat = { normalizePitch, normalizePiece };
})();
