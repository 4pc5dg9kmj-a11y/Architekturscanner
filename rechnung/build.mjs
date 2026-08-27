#!/usr/bin/env node
/* Baut aus den Modulen in src/ eine einzige, in sich geschlossene index.html.
 *
 *   node rechnung/build.mjs
 *
 * Ergebnis laeuft ohne Server, ohne Internet und ohne Fremdbibliotheken –
 * per Doppelklick, vom USB-Stick oder als Web-App auf dem Handy.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const REIHENFOLGE = ['pdf.mjs', 'invoice.mjs', 'positionen.mjs', 'parse.mjs', 'ui.mjs'];

const teile = REIHENFOLGE.map((datei) => {
  const quelle = readFileSync(join(hier, 'src', datei), 'utf8');
  const ohneImporte = quelle.replace(/^\s*import\s+[^;]*?from\s+'[^']+';\s*$/gm, '');
  const ohneExporte = ohneImporte.replace(/^export\s+(?=(const|let|var|function|class|async))/gm, '');
  return `/* ---- ${datei} ---- */\n${ohneExporte.trim()}`;
});

const bundle = `'use strict';\n(function(){\n${teile.join('\n\n')}\n})();`;
const vorlage = readFileSync(join(hier, 'src', 'index.template.html'), 'utf8');
if (!vorlage.includes('/*__JS__*/')) throw new Error('Platzhalter /*__JS__*/ fehlt in der Vorlage.');

const ziel = join(hier, 'index.html');
writeFileSync(ziel, vorlage.replace('/*__JS__*/', () => bundle));
console.log(`${ziel} (${Math.round(bundle.length / 1024)} kB JavaScript)`);
