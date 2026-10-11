(() => {
  const DIVISIONS = 4;
  const MAJOR_FIFTHS = {
    'Cb major': -7,
    'Gb major': -6,
    'Db major': -5,
    'Ab major': -4,
    'Eb major': -3,
    'Bb major': -2,
    'F major': -1,
    'C major': 0,
    'G major': 1,
    'D major': 2,
    'A major': 3,
    'E major': 4,
    'B major': 5,
    'F# major': 6,
    'C# major': 7
  };
  const MINOR_FIFTHS = {
    'Ab minor': -7,
    'Eb minor': -6,
    'Bb minor': -5,
    'F minor': -4,
    'C minor': -3,
    'G minor': -2,
    'D minor': -1,
    'A minor': 0,
    'E minor': 1,
    'B minor': 2,
    'F# minor': 3,
    'C# minor': 4,
    'G# minor': 5,
    'D# minor': 6,
    'A# minor': 7
  };

  function escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function quarterLength(beats, beatType) {
    const beatCount = Number(beats);
    const type = Number(beatType);
    if (!(beatCount > 0) || !(type > 0)) return 4;
    return (beatCount * 4) / type;
  }

  function pieceBars(piece) {
    if (Array.isArray(piece.bars) && piece.bars.length) return piece.bars;
    const [beats, beatType] = piece.timeSignature || [4, 4];
    const length = quarterLength(beats, beatType);
    let limit = length;
    (piece.notes || []).forEach(note => {
      const end = Number(note.start) + Number(note.duration);
      if (Number.isFinite(end) && end > limit) limit = end;
    });
    const bars = [];
    let start = 0;
    let number = 1;
    while (start < limit - 1e-6 && bars.length < 10000) {
      bars.push({
        start,
        end: start + length,
        number,
        implicit: false,
        beats: Number(beats) || 4,
        beatType: Number(beatType) || 4
      });
      start += length;
      number += 1;
    }
    return bars;
  }

  function keyMarkup(name) {
    const label = String(name || 'C major');
    if (Object.prototype.hasOwnProperty.call(MINOR_FIFTHS, label)) {
      return `<fifths>${MINOR_FIFTHS[label]}</fifths><mode>minor</mode>`;
    }
    const fifths = MAJOR_FIFTHS[label] ?? 0;
    return `<fifths>${fifths}</fifths><mode>major</mode>`;
  }

  function typeMarkup(divs) {
    const quarters = divs / DIVISIONS;
    const kinds = [
      [4, 'whole'],
      [2, 'half'],
      [1, 'quarter'],
      [0.5, 'eighth'],
      [0.25, '16th'],
      [0.125, '32nd'],
      [0.0625, '64th']
    ];
    for (let index = 0; index < kinds.length; index += 1) {
      const [base, name] = kinds[index];
      for (let dots = 0; dots <= 2; dots += 1) {
        const expected = base * (2 - 0.5 ** dots);
        if (Math.abs(expected - quarters) < 1e-3) {
          return `<type>${name}</type>${'<dot/>'.repeat(dots)}`;
        }
      }
    }
    return '';
  }

  function pitchMarkup(pitch) {
    const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch || '');
    if (!match) return '<rest/>';
    const alter =
      match[2] === '#' ? '<alter>1</alter>' : match[2] === 'b' ? '<alter>-1</alter>' : '';
    return `<pitch><step>${match[1]}</step>${alter}<octave>${match[3]}</octave></pitch>`;
  }

  function notations(item) {
    const tie = [
      item.tieStop ? '<tied type="stop"/>' : '',
      item.tieStart ? '<tied type="start"/>' : ''
    ].join('');
    const finger =
      Number.isInteger(item.finger) && item.finger >= 1 && item.finger <= 5
        ? `<technical><fingering>${item.finger}</fingering></technical>`
        : '';
    if (!tie && !finger) return '';
    return `<notations>${tie}${finger}</notations>`;
  }

  function noteMarkup(item, divs, voice, staff, chord) {
    const ties = [
      item.tieStop ? '<tie type="stop"/>' : '',
      item.tieStart ? '<tie type="start"/>' : ''
    ].join('');
    return `<note>${chord ? '<chord/>' : ''}${pitchMarkup(item.pitch)}<duration>${divs}</duration>${typeMarkup(divs)}${ties}<voice>${voice}</voice><staff>${staff}</staff>${notations(item)}</note>`;
  }

  function restMarkup(divs, voice, staff) {
    if (divs <= 0) return '';
    return `<note><rest/><duration>${divs}</duration>${typeMarkup(divs)}<voice>${voice}</voice><staff>${staff}</staff></note>`;
  }

  function voiceMarkup(notes, bar, hand) {
    const staff = hand === 'left' ? 2 : 1;
    const voice = staff;
    const barDiv = Math.max(1, Math.round((bar.end - bar.start) * DIVISIONS));
    const items = [];
    (notes || []).forEach(note => {
      if ((note.hand || 'right') !== hand) return;
      const noteEnd = Number(note.start) + Number(note.duration);
      const start = Math.max(Number(note.start), bar.start);
      const end = Math.min(noteEnd, bar.end);
      if (!(end > start + 1e-6)) return;
      let rel = Math.round((start - bar.start) * DIVISIONS);
      let dur = Math.round((end - start) * DIVISIONS);
      if (Math.abs(end - bar.end) < 1e-3) dur = barDiv - rel;
      if (rel < 0) rel = 0;
      if (rel >= barDiv || dur <= 0) return;
      if (rel + dur > barDiv) dur = barDiv - rel;
      items.push({
        pitch: note.pitch,
        rel,
        dur,
        finger: note.finger,
        tieStop: Number(note.start) < bar.start - 1e-4,
        tieStart: noteEnd > bar.end + 1e-4
      });
    });
    items.sort((a, b) => a.rel - b.rel || b.pitch.localeCompare(a.pitch));

    const groups = [];
    items.forEach(item => {
      const last = groups[groups.length - 1];
      if (last && last.rel === item.rel) last.items.push(item);
      else groups.push({ rel: item.rel, items: [item] });
    });

    let xml = '';
    let emitted = 0;
    groups.forEach(group => {
      if (group.rel > emitted) {
        xml += restMarkup(group.rel - emitted, voice, staff);
        emitted = group.rel;
      }
      const step = group.items[0].dur;
      group.items.forEach((item, index) => {
        xml += noteMarkup(item, item.dur, voice, staff, index > 0);
      });
      emitted += step;
    });
    if (emitted < barDiv) xml += restMarkup(barDiv - emitted, voice, staff);
    return xml;
  }

  function notesToMusicXml(piece) {
    const bars = pieceBars(piece);
    const title = escapeXml(piece.title || 'Untitled');
    const composer = escapeXml(piece.composer || 'Unknown composer');
    const tempo = Math.round(Number(piece.tempo) || 90);
    let previousSignature = '';
    const measures = bars
      .map((bar, index) => {
        const signature = `${bar.beats}/${bar.beatType}`;
        const attributes = [];
        if (index === 0) {
          attributes.push(`<divisions>${DIVISIONS}</divisions>`);
          attributes.push(`<key>${keyMarkup(piece.key)}</key>`);
        }
        if (signature !== previousSignature) {
          attributes.push(
            `<time><beats>${bar.beats}</beats><beat-type>${bar.beatType}</beat-type></time>`
          );
          previousSignature = signature;
        }
        if (index === 0) {
          attributes.push('<staves>2</staves>');
          attributes.push('<clef number="1"><sign>G</sign><line>2</line></clef>');
          attributes.push('<clef number="2"><sign>F</sign><line>4</line></clef>');
        }
        const attributeXml = attributes.length
          ? `<attributes>${attributes.join('')}</attributes>`
          : '';
        const direction =
          index === 0
            ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>`
            : '';
        const number = bar.implicit ? 0 : bar.number || index + 1;
        const implicit = bar.implicit ? ' implicit="yes"' : '';
        const right = voiceMarkup(piece.notes, bar, 'right');
        const left = voiceMarkup(piece.notes, bar, 'left');
        const barDiv = Math.max(1, Math.round((bar.end - bar.start) * DIVISIONS));
        return `<measure number="${number}"${implicit}>${attributeXml}${direction}${right}<backup><duration>${barDiv}</duration></backup>${left}</measure>`;
      })
      .join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${title}</work-title></work>
  <identification><creator type="composer">${composer}</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;
  }

  globalThis.notesToMusicXml = notesToMusicXml;
})();
