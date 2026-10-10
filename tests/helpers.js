import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadImporter() {
  const code = fs.readFileSync(path.join(root, 'musicxml-import.js'), 'utf8');
  window.eval(code);
  return window.PianoMusicXML;
}

export function noteElement(inner) {
  const doc = new DOMParser().parseFromString(`<note>${inner}</note>`, 'application/xml');
  return doc.documentElement;
}

export function score(inner, { rootName = 'score-partwise', xmlns = '' } = {}) {
  const ns = xmlns ? ` xmlns="${xmlns}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<${rootName} version="4.0"${ns}>
  <work><work-title>Fixture</work-title></work>
  <identification><creator type="composer">Fixture</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${inner}
  </part>
</${rootName}>`;
}
