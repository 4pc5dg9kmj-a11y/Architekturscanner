#!/usr/bin/env node
/* Rechnung aus einer JSON-Datei erzeugen.
 *
 *   node rechnung/cli.mjs daten.json                 -> Rechnung_<Nr>.pdf
 *   node rechnung/cli.mjs daten.json ausgabe.pdf
 *   cat daten.json | node rechnung/cli.mjs -         -> Rechnung_<Nr>.pdf
 *
 * Ein Feld "positionen" kann weggelassen werden: dann wird aus Zeitraum,
 * Naechten und "intern.gesamtpreis" automatisch eine Uebernachtungsposition
 * gebaut.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { baueRechnungPdf, dateiname, normalisiere } from './src/invoice.mjs';
import { standardPosition } from './src/positionen.mjs';

function lies(quelle) {
  if (quelle === '-' || !quelle) return readFileSync(0, 'utf8');
  return readFileSync(resolve(quelle), 'utf8');
}

const [, , eingabe, ausgabe] = process.argv;
if (eingabe === '--hilfe' || eingabe === '-h') {
  console.log('Aufruf: node rechnung/cli.mjs <daten.json|-> [ausgabe.pdf]');
  process.exit(0);
}

let daten;
try {
  daten = JSON.parse(lies(eingabe));
} catch (fehler) {
  console.error(`Konnte JSON nicht lesen: ${fehler.message}`);
  process.exit(1);
}

let model = normalisiere(daten);
if (!model.zeilen.length) {
  daten.positionen = [standardPosition(model)];
  model = normalisiere(daten);
}
if (!model.zeilen.length) {
  console.error('Keine Positionen – bitte "positionen" oder "intern.gesamtpreis" angeben.');
  process.exit(1);
}

const ziel = resolve(ausgabe || dateiname(model));
writeFileSync(ziel, baueRechnungPdf(model));
console.log(ziel);
