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

There is no build step and no external dependency. Open `index.html` directly or serve the repository as a static site.

## Data model

Every view reads the same notes from `data.js`.

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

## Demo content

The repository currently contains:

1. C major scale — two-hand technical data demo
2. Beethoven, Ode to Joy — short theme with a simple bass line for testing

The demo arrangements are there to test functionality, not to define a pedagogical curriculum.

## Logical next technical step

For a real library of pieces, keep this UI/data separation but add an import pipeline:

`MusicXML -> normalised internal note model -> all renderers`

A dedicated notation library can later replace the simple SVG score renderer if full engraving support is required (beaming, ties, tuplets, voices, articulations, complex accidentals, etc.). The falling-notes renderer and the rest of the app can continue to use the same normalised notes.
