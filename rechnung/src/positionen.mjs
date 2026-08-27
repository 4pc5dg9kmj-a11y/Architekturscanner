/* Baut aus Buchungsdaten die uebliche Uebernachtungsposition. */

import { formatDatum, naechteZwischen, parseBetrag } from './invoice.mjs';

export function standardPosition(daten) {
  const r = daten.rechnung || {};
  const v = daten.vermieter || {};
  const naechte = Number(r.naechte) || naechteZwischen(r.anreise, r.abreise) || 1;
  const gesamt = parseBetrag((daten.intern || {}).gesamtpreis);

  const details = [];
  const ort = v.ort || 'Guxhagen';
  const zeitraum = [formatDatum(r.anreise), formatDatum(r.abreise)].filter(Boolean).join(' – ');
  if (zeitraum) details.push(`${ort} (Zeitraum: ${zeitraum})`);
  details.push(`${naechte} Übernachtung${naechte === 1 ? '' : 'en'}`);
  if (r.gaeste) details.push(`${r.gaeste} Gast${Number(r.gaeste) === 1 ? '' : '/Gäste'}`);
  if (r.buchungsnummer) {
    details.push(`Buchungsnr.: ${r.buchungsnummer}${r.portal ? ` (${r.portal})` : ''}`);
  }

  return {
    auto: true,
    titel: `Übernachtung im ${v.objekt || 'Apartment'}`,
    details,
    menge: naechte,
    einheit: naechte === 1 ? 'Nacht' : 'Nächte',
    // Ungerundet, damit Menge x Einzelpreis exakt den Gesamtpreis ergibt.
    einzelpreis: naechte ? gesamt / naechte : gesamt,
  };
}
