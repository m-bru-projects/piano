# Piano library

A small piano app that engraves a piece as sheet music, with note names or fingering on that score, and as falling notes. There is no build step. The page is plain HTML, CSS and JavaScript.

## Run the app

Demos work if you open `index.html` directly. The standard library is fetched when you pick a piece, and browsers block that fetch from `file://`, so serve the folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Pushes to `main` publish this same folder, including `library/`, with GitHub Actions (`.github/workflows/pages.yml`). Pages serves it over HTTP, so the piece menu can load the manifest.

## Current functionality

- Engraved grand staff (beams, rests, flags, dots, clefs, key and time signatures) via OpenSheetMusicDisplay
- The same score with note-name labels
- The same score with fingering numbers
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

The timeline is in quarter notes. A 6/8 bar is three quarters long, a pickup bar is only as long as its contents, and a time-signature change starts a new bar length. The engraved score uses those same MusicXML bar boundaries.

The score view is [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) 2.2.0, vendored at `vendor/opensheetmusicdisplay.min.js` under the BSD-3-Clause license (`vendor/OSMD-LICENSE.txt`). The script is a browser bundle, so the page still has no build step. Library pieces and local imports are drawn from their original MusicXML. The two built-in demos are turned into MusicXML by `musicxml-export.js` and then engraved the same way. Note names are labels placed on the engraved noteheads. Fingerings that are already in the MusicXML are drawn by OpenSheetMusicDisplay; fingerings filled in by this app use a dashed circle. A highlight follows the audio clock, including while you scrub. Falling notes stay on the shared note model and are not redrawn from the engraved page.

Notes are scheduled on the audio clock with a short lookahead, so timing does not depend on `requestAnimationFrame` and playback can keep going when the tab is in the background. Pausing or scrubbing in the middle of a note sounds the remainder of that note when playback continues. The score is not redrawn while playback is paused; only the highlight moves.

## Automatic fingering

`piano-enhancements.js` loads after `app.js`. It fills in missing fingering when a piece is added: chords use a simple 1–5 pattern (mirrored in the left hand) and single notes walk from the previous finger. Generated numbers are drawn with a dashed circle so they stay distinct from fingerings that came from the score. MusicXML `fingering` elements are kept as written and engraved with the score.

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
- The engraved page shows the imported MusicXML, including beams, rests, dots and signatures. Slurs, articulations and tuplets appear when the file contains them. Playback still follows `duration` and `divisions`.
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
- `app.js` — OpenSheetMusicDisplay score, falling-notes renderer, transport and audio
- `musicxml-export.js` — writes MusicXML for the built-in demos
- `piano-enhancements.js` — automatic fingering
- `musicxml-import.js` — local MusicXML/MXL parser, IndexedDB and import UI
- `library.js` — loads `library/manifest.json` and fetches a score on demand
- `library/` — standard-library manifest and MusicXML scores
- `vendor/` — OpenSheetMusicDisplay 2.2.0 and its license
- `samples/import-test.musicxml` — small import test score
- `tests/` — Vitest tests for the importer, exporter, ZIP reader, pitch parsing and library

## Tests and lint

Tooling is dev-only. The page still runs without `npm install`.

```bash
npm install
npm test
npm run lint
npm run format:check
```

GitHub Actions runs those three checks on Node 22.
