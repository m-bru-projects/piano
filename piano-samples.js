(() => {
  const SAMPLE_ROOT = 24;
  const SAMPLE_STEP = 3;
  const SAMPLE_TOP = 108;
  const SAMPLE_MIDIS = [];
  for (let midi = SAMPLE_ROOT; midi <= SAMPLE_TOP; midi += SAMPLE_STEP) SAMPLE_MIDIS.push(midi);

  const NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

  function sampleName(midi) {
    const pitchClass = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return `${NAMES[pitchClass]}${octave}`;
  }

  function playbackRate(targetMidi, sampleMidi) {
    return 2 ** ((targetMidi - sampleMidi) / 12);
  }

  function nearestSample(midi) {
    const target = Number(midi);
    if (!Number.isFinite(target)) return null;
    const exact = (target - SAMPLE_ROOT) / SAMPLE_STEP;
    const lower = Math.floor(exact);
    const fraction = exact - lower;
    let index = fraction > 0.5 ? lower + 1 : lower;
    if (index < 0) index = 0;
    if (index >= SAMPLE_MIDIS.length) index = SAMPLE_MIDIS.length - 1;
    const sampleMidi = SAMPLE_MIDIS[index];
    return {
      midi: sampleMidi,
      name: sampleName(sampleMidi),
      playbackRate: playbackRate(target, sampleMidi)
    };
  }

  function velocityGain(note) {
    const raw = note && note.velocity;
    if (raw == null || raw === '') return 0.82;
    const value = Number(raw);
    if (!Number.isFinite(value)) return 0.82;
    const gain = value > 1 ? value / 127 : value;
    return Math.max(0, Math.min(1, gain));
  }

  function sampleUrl(name, base = 'samples/piano/') {
    return `${base}${name}.mp3`;
  }

  window.PianoSamples = {
    SAMPLE_MIDIS,
    sampleName,
    nearestSample,
    playbackRate,
    velocityGain,
    sampleUrl
  };
})();
