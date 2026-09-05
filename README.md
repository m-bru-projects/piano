# Piano prototype

A small functional proof of concept for rendering the same piano piece in multiple ways.

## Current functionality

- Grand-staff style score with separate right and left hand
- Score with note names
- Score with fingering numbers
- Falling-notes piano visualisation
- Play / pause / restart
- Scrubbable playback position
- Adjustable tempo
- Lightweight Web Audio playback
- Responsive layout
- Piece selector
- Local MusicXML import (`.musicxml`, `.xml` and `.mxl`)

There is no build step and no external dependency. Open `index.html` directly or serve the repository as a static site.

## MusicXML import

Use **Import MusicXML** next to the piece selector and choose a local score. The file never needs to leave the browser.

The importer currently reads:

- pitched notes and durations
- chords
- rests and measure timing
- multiple voices using MusicXML `backup` / `forward`
- piano staff 1 / staff 2 as right / left hand
- key and time signature
- tempo from MusicXML sound/metronome data
- fingering from `notations > technical > fingering`
- compressed `.mxl` files using the browser's built-in decompression support

The imported score is normalised to the exact same internal note model used by the built-in demo pieces. It therefore works immediately in score, note-name, fingering and falling-notes views.

Imports currently live in memory for the active browser session; refreshing `index.html` clears them. This keeps the first implementation fully local and storage-free.

A small known-good import file is included at `samples/import-test.musicxml`.

### Current MusicXML limits

- `score-partwise` is supported; `score-timewise` is not yet supported.
- Complex engraving information such as beams, slurs, articulations, tuplets and layout instructions is not reproduced by the prototype SVG renderer.
- Multi-instrument scores are flattened into the shared piano note model. Piano scores with staff 1/2 are the intended input.
- Very unusual/microtonal accidentals are normalised to the nearest chromatic pitch supported by the prototype.

## Data model

Every view reads the same notes from `data.js` or from a MusicXML import.

```js
{
  pitch: "E4",
  start: 6,
  duration: 1,
  hand: "right",
  finger: 3
}
```

Piece-level metadata contains title, composer, key, time signature, default tempo and level.

This separation is deliberate: notation, labels, fingering and falling notes should never need separate copies of the composition.

## Files

- `index.html` — application shell and controls
- `styles.css` — layout and responsive styling
- `data.js` — shared music data and demo pieces
- `app.js` — notation renderer, falling-notes renderer, transport and audio
- `musicxml-import.js` — local MusicXML/MXL parser and import UI
- `samples/import-test.musicxml` — small import test score

## Demo content

The repository currently contains:

1. C major scale — two-hand technical data demo
2. Beethoven, Ode to Joy — short theme with a simple bass line for testing

The demo arrangements are there to test functionality, not to define a pedagogical curriculum.

## Architecture

The import pipeline is now:

`MusicXML / MXL -> normalised internal note model -> all renderers`

A dedicated notation library can later replace the simple SVG score renderer if full engraving support is required. The falling-notes renderer and the rest of the app can continue to use the same normalised notes.
