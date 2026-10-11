(() => {
  const pieces = window.PIANO_PIECES;
  const pieceSelect = document.getElementById('pieceSelect');
  const scoreSvg = document.getElementById('scoreSvg');
  if (!Array.isArray(pieces) || !pieceSelect) return;

  const naturalPitchClass = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function pitchToMidi(pitch) {
    const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch || '');
    if (!match) return NaN;
    const [, letter, accidental, octaveText] = match;
    const accidentalOffset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
    return (Number(octaveText) + 1) * 12 + naturalPitchClass[letter] + accidentalOffset;
  }

  function hasFinger(note) {
    return Number.isInteger(note?.finger) && note.finger >= 1 && note.finger <= 5;
  }

  function chordPattern(count) {
    if (count <= 1) return [3];
    if (count === 2) return [1, 5];
    if (count === 3) return [1, 3, 5];
    if (count === 4) return [1, 2, 4, 5];
    return [1, 2, 3, 4, 5];
  }

  function markGenerated(note, finger) {
    if (hasFinger(note)) return false;
    note.finger = Math.max(1, Math.min(5, Math.round(finger)));
    note.generatedFinger = true;
    return true;
  }

  function notesByHand(piece, hand) {
    return piece.notes
      .map((note, index) => ({ note, index, midi: pitchToMidi(note.pitch) }))
      .filter(item => item.note.hand === hand && Number.isFinite(item.midi))
      .sort((a, b) => a.note.start - b.note.start || a.midi - b.midi);
  }

  function groupByStart(items) {
    const groups = [];
    let current = null;
    for (const item of items) {
      const key = Number(item.note.start).toFixed(6);
      if (!current || current.key !== key) {
        current = { key, items: [] };
        groups.push(current);
      }
      current.items.push(item);
    }
    return groups;
  }

  function generateChordFingers(group, hand) {
    if (group.length < 2) return 0;

    const ordered = [...group].sort((a, b) => a.midi - b.midi);
    const distinctRanks = [];
    for (const item of ordered) {
      const previous = distinctRanks[distinctRanks.length - 1];
      if (!previous || previous.midi !== item.midi) {
        distinctRanks.push({ midi: item.midi, items: [item] });
      } else {
        previous.items.push(item);
      }
    }

    const pattern = chordPattern(Math.min(5, distinctRanks.length));
    let generated = 0;
    distinctRanks.forEach((rank, rankIndex) => {
      let finger;
      if (distinctRanks.length <= 5) {
        finger = pattern[rankIndex];
      } else {
        finger = 1 + Math.round((rankIndex / Math.max(1, distinctRanks.length - 1)) * 4);
      }
      if (hand === 'left') finger = 6 - finger;

      rank.items.forEach(item => {
        if (markGenerated(item.note, finger)) generated += 1;
      });
    });
    return generated;
  }

  function firstFingerForDirection(hand, currentMidi, nextMidi) {
    if (!Number.isFinite(nextMidi) || nextMidi === currentMidi) return 3;
    const ascending = nextMidi > currentMidi;
    if (hand === 'right') return ascending ? 1 : 5;
    return ascending ? 5 : 1;
  }

  function nextFingerFromPrevious(hand, previousMidi, previousFinger, midi) {
    const delta = midi - previousMidi;
    if (!delta) return previousFinger;

    const direction = Math.sign(delta);
    const step = Math.max(1, Math.min(3, Math.round(Math.abs(delta) / 2)));
    const handDirection = hand === 'right' ? direction : -direction;
    let finger = previousFinger + handDirection * step;

    if (finger > 5) finger = hand === 'right' ? (direction > 0 ? 1 : 5) : direction < 0 ? 1 : 5;
    if (finger < 1) finger = hand === 'right' ? (direction < 0 ? 5 : 1) : direction > 0 ? 5 : 1;

    return Math.max(1, Math.min(5, finger));
  }

  function generateSingleNoteFingers(groups, hand) {
    let generated = 0;
    let previousMidi = NaN;
    let previousFinger = NaN;

    groups.forEach((group, groupIndex) => {
      if (group.items.length !== 1) {
        const ordered = [...group.items].sort((a, b) => a.midi - b.midi);
        const anchor = hand === 'right' ? ordered[ordered.length - 1] : ordered[0];
        if (anchor && hasFinger(anchor.note)) {
          previousMidi = anchor.midi;
          previousFinger = anchor.note.finger;
        }
        return;
      }

      const item = group.items[0];
      if (hasFinger(item.note)) {
        previousMidi = item.midi;
        previousFinger = item.note.finger;
        return;
      }

      let finger;
      if (Number.isFinite(previousMidi) && Number.isFinite(previousFinger)) {
        finger = nextFingerFromPrevious(hand, previousMidi, previousFinger, item.midi);
      } else {
        const nextSingle = groups
          .slice(groupIndex + 1)
          .map(nextGroup => (nextGroup.items.length === 1 ? nextGroup.items[0] : null))
          .find(Boolean);
        finger = firstFingerForDirection(hand, item.midi, nextSingle?.midi);
      }

      if (markGenerated(item.note, finger)) generated += 1;
      previousMidi = item.midi;
      previousFinger = item.note.finger;
    });

    return generated;
  }

  function ensureFingering(piece) {
    if (!piece || !Array.isArray(piece.notes) || piece.notes.length === 0) return 0;
    if (piece.__autoFingeringComplete) return piece.__generatedFingerCount || 0;

    let generated = 0;
    ['right', 'left'].forEach(hand => {
      const groups = groupByStart(notesByHand(piece, hand));
      groups.forEach(group => {
        generated += generateChordFingers(group.items, hand);
      });
      generated += generateSingleNoteFingers(groups, hand);
    });

    piece.__autoFingeringComplete = true;
    piece.__generatedFingerCount = generated;
    if (
      generated > 0 &&
      typeof piece.description === 'string' &&
      !piece.description.includes('fingering generated')
    ) {
      piece.description += ` · ${generated} fingering${generated === 1 ? '' : 's'} generated`;
    }
    return generated;
  }

  function currentPiece() {
    return pieces.find(piece => piece.id === pieceSelect.value) || pieces[0];
  }

  function centeredOffset(index, count, spacing) {
    return (index - (count - 1) / 2) * spacing;
  }

  function layoutChordLabels() {
    if (!scoreSvg) return;
    const activeView = document.querySelector('.view-tab.is-active')?.dataset.view;
    if (activeView !== 'letters' && activeView !== 'fingering') return;

    const piece = currentPiece();
    if (!piece) return;

    const simultaneous = new Map();
    piece.notes.forEach((note, index) => {
      const key = `${note.hand}|${Number(note.start).toFixed(6)}`;
      if (!simultaneous.has(key)) simultaneous.set(key, []);
      simultaneous.get(key).push({ note, index, midi: pitchToMidi(note.pitch) });
    });

    simultaneous.forEach(items => {
      if (items.length < 2) return;
      items.sort((a, b) => a.midi - b.midi || a.index - b.index);
      const spacing = activeView === 'letters' ? 18 : 22;

      items.forEach((item, rank) => {
        const group = scoreSvg.querySelector(`g[data-note="${item.index}"]`);
        if (!group) return;
        const dx = centeredOffset(rank, items.length, spacing);
        const texts = [...group.querySelectorAll('text')];
        const label = texts[texts.length - 1];
        if (!label) return;

        label.setAttribute('transform', `translate(${dx} 0)`);
        if (activeView === 'letters') {
          label.setAttribute('paint-order', 'stroke');
          label.setAttribute('stroke', '#fffdf8');
          label.setAttribute('stroke-width', '3');
          label.setAttribute('stroke-linejoin', 'round');
        } else {
          const circle = group.querySelector('circle');
          if (circle) circle.setAttribute('transform', `translate(${dx} 0)`);
          if (item.note.generatedFinger) {
            if (circle) {
              circle.setAttribute('stroke-dasharray', '2 2');
              circle.setAttribute('opacity', '0.88');
            }
            label.setAttribute('opacity', '0.88');
          }
        }
      });
    });

    if (activeView === 'fingering') {
      piece.notes.forEach((note, index) => {
        if (!note.generatedFinger) return;
        const group = scoreSvg.querySelector(`g[data-note="${index}"]`);
        if (!group) return;
        const circle = group.querySelector('circle');
        const texts = [...group.querySelectorAll('text')];
        const label = texts[texts.length - 1];
        if (circle) {
          circle.setAttribute('stroke-dasharray', '2 2');
          circle.setAttribute('opacity', '0.88');
        }
        if (label) label.setAttribute('opacity', '0.88');
        group.setAttribute('aria-label', `Generated fingering ${note.finger}`);
      });
    }
  }

  let layoutQueued = false;
  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      layoutChordLabels();
    });
  }

  pieces.forEach(ensureFingering);

  const originalPush = pieces.push.bind(pieces);
  Object.defineProperty(pieces, 'push', {
    configurable: true,
    writable: true,
    value(...items) {
      items.forEach(ensureFingering);
      return originalPush(...items);
    }
  });

  if (scoreSvg) {
    const observer = new MutationObserver(queueLayout);
    observer.observe(scoreSvg, { childList: true, subtree: true });
  }
  document.querySelectorAll('.view-tab').forEach(tab => tab.addEventListener('click', queueLayout));
  pieceSelect.addEventListener('change', queueLayout);

  pieceSelect.dispatchEvent(new Event('change', { bubbles: true }));
  queueLayout();

  window.PianoEnhancements = { ensureFingering, layoutChordLabels };
})();
