# Piano library

A small piano app that renders one piece as a grand staff, as note names, as fingering, and as falling notes. There is no build step. The page is plain HTML, CSS and JavaScript.

## Run the app

Demos work if you open `index.html` directly. The standard library is fetched when you pick a piece, and browsers block that fetch from `file://`, so serve the folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Current functionality

- Grand-staff score with separate right and left hands
- Score with note names
- Score with fingering numbers
- Falling-notes piano visualisation
- Play / pause / restart
- Scrubbable playback position
- Tempo from 30 to 240 BPM
- Web Audio playback scheduled from `audioContext.currentTime`
- Keyboard shortcuts: Space plays or pauses, Left and Right arrow step a bar
- Piece selector with demos, the standard library, and your imports
- Local MusicXML import (`.musicxml`, `.xml` and `.mxl`)
- Imported pieces saved in IndexedDB, with **Remove import** to delete the selected one

## Playback and notation

The timeline is in quarter notes. A 6/8 bar is three quarters long, a pickup bar is only as long as its contents, and a time-signature change starts a new bar length. Bar lines and bar numbers follow those boundaries.

Notes are scheduled on the audio clock with a short lookahead, so timing does not depend on `requestAnimationFrame` and playback can keep going when the tab is in the background. Pausing or scrubbing in the middle of a note sounds the remainder of that note when playback continues. The score is not redrawn while playback is paused.

## Automatic fingering

`piano-enhancements.js` loads after `app.js`. It fills in missing fingering when a piece is added: chords use a simple 1–5 pattern (mirrored in the left hand) and single notes walk from the previous finger. Generated numbers are drawn with a dashed circle so they stay distinct from fingerings that came from the score. MusicXML `fingering` elements are kept as written.

## MusicXML import

Use **Import MusicXML** next to the piece selector. Parsing happens in the browser.

The importer reads:

- pitched notes and durations, including ties joined into one sounding note
- chords
- rests and measure timing, including pickups (`implicit="yes"`) and mid-score time changes
- multiple voices using MusicXML `backup` / `forward`
- piano staff 1 / staff 2 as right / left hand
- key and time signature
- tempo from MusicXML sound or metronome data, clamped to 30–240 BPM
- fingering from `notations > technical > fingering`
- compressed `.mxl` files when the browser provides `DecompressionStream` (current Chrome, Firefox and Safari)

`.mxl` archives are limited to 256 entries, 64 MB compressed, 32 MB per entry and 64 MB uncompressed in total. ZIP64, absolute paths and `..` paths are rejected.

An imported piece is saved in IndexedDB (`piano-library` / `imports`) and restored on the next visit. **Remove import** deletes it from the page and from IndexedDB. Library scores and the built-in demos are not stored there.

A small known-good import file is included at `samples/import-test.musicxml`.

### Current MusicXML limits

- `score-partwise` is supported; `score-timewise` is not yet supported.
- Complex engraving such as beams, slurs, articulations, tuplets and layout is not drawn by the SVG renderer. Tuplet timing still follows `duration` and `divisions`.
- Multi-instrument scores are flattened into the shared piano note model. Piano scores with staff 1/2 are the intended input.
- Unusual or microtonal accidentals are normalised to the nearest chromatic pitch.

## Standard library

`library/manifest.json` lists 43 beginner and intermediate pieces, including Bach's Prelude in C major, BWV 846. Choosing one fetches its MusicXML and imports it with the same parser as a local file. Sources and licenses are in [LIBRARY.md](LIBRARY.md).

## Data model

Every view reads the same notes from `data.js`, a library score, or a MusicXML import.

```js
{
  pitch: "E4",
  start: 6,
  duration: 1,
  hand: "right",
  finger: 3
}
```

`start` and `duration` are quarter-note beats. Imported pieces also carry `bars`: `{ start, end, number, implicit, beats, beatType }`. Demos without `bars` get even bars from their time signature.

## Files

- `index.html` — application shell and controls
- `styles.css` — layout and responsive styling
- `data.js` — shared music data and demo pieces
- `app.js` — notation renderer, falling-notes renderer, transport and audio
- `piano-enhancements.js` — automatic fingering and fingering-label layout
- `musicxml-import.js` — local MusicXML/MXL parser, IndexedDB and import UI
- `library.js` — loads `library/manifest.json` and fetches a score on demand
- `library/` — standard-library manifest and MusicXML scores
- `samples/import-test.musicxml` — small import test score
- `tests/` — Vitest tests for the importer, ZIP reader, pitch parsing and library

## Tests and lint

Tooling is dev-only. The page still runs without `npm install`.

```bash
npm install
npm test
npm run lint
npm run format:check
```

GitHub Actions runs those three checks on Node 22.
