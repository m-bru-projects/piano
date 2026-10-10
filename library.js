(() => {
  const pieces = window.PIANO_PIECES;
  const pieceSelect = document.getElementById('pieceSelect');
  const libraryGroup = document.getElementById('libraryPieces');
  if (!Array.isArray(pieces) || !pieceSelect || !libraryGroup || !window.PianoMusicXML?.parse)
    return;

  const status = () => document.getElementById('musicXmlStatus');
  let manifest = [];
  let requestToken = 0;

  function setStatus(message, isError = false) {
    const node = status();
    if (!node) return;
    node.classList.toggle('is-error', isError);
    node.textContent = message;
  }

  function optionFor(entry) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = `${entry.title} — ${entry.composer}`;
    option.dataset.library = 'true';
    return option;
  }

  async function loadEntry(entry) {
    const token = ++requestToken;
    setStatus('Loading score…');
    const response = await fetch(entry.file);
    if (!response.ok) throw new Error(`Could not load ${entry.title}`);
    const xml = await response.text();
    if (token !== requestToken) return null;
    const piece = window.PianoMusicXML.parse(xml, entry.file);
    piece.id = entry.id;
    piece.title = entry.title;
    piece.composer = entry.composer;
    piece.level = entry.level || piece.level;
    piece.license = entry.license;
    piece.source = entry.source;
    const license = entry.license ? ` · ${entry.license}` : '';
    piece.description = `${entry.description || entry.title} · ${piece.notes.length} notes${license}`;
    return piece;
  }

  async function selectEntry(entry) {
    const existing = pieces.find(piece => piece.id === entry.id);
    if (existing) {
      window.PianoApp?.setPiece(existing);
      setStatus('');
      return;
    }
    try {
      const piece = await loadEntry(entry);
      if (!piece || pieceSelect.value !== entry.id) return;
      if (!pieces.some(item => item.id === piece.id)) pieces.push(piece);
      window.PianoApp?.setPiece(piece);
      setStatus(`${piece.notes.length} notes`);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Could not load this score', true);
    }
  }

  pieceSelect.addEventListener('change', () => {
    const entry = manifest.find(item => item.id === pieceSelect.value);
    if (entry) selectEntry(entry);
  });

  fetch('./library/manifest.json')
    .then(response => {
      if (!response.ok) throw new Error('Library manifest was not found');
      return response.json();
    })
    .then(entries => {
      if (!Array.isArray(entries)) return;
      manifest = entries;
      entries.forEach(entry => libraryGroup.appendChild(optionFor(entry)));
    })
    .catch(error => {
      console.warn(error);
      setStatus('Score library unavailable', true);
    });
})();
