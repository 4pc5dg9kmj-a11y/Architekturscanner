/* Baut aus Buchungsdaten die uebliche Uebernachtungsposition. */

import { formatDatum, naechteZwischen, parseBetrag } from './invoice.mjs';

export function standardPosition(daten) {
  const r = daten.rechnung || {};
  const v = daten.vermieter || {};
  // Nur nennen, was bekannt ist – nichts hinzudichten.
  const naechte = Number(r.naechte) || naechteZwischen(r.anreise, r.abreise) || 0;
  const gesamt = parseBetrag((daten.intern || {}).gesamtpreis);

  const zeitraum = [formatDatum(r.anreise), formatDatum(r.abreise)].filter(Boolean).join(' – ');
  // Der Ort allein sagt nichts – er begleitet Zeitraum oder Nächte.
  const erste = (naechte || zeitraum)
    ? [
      naechte ? `${naechte} ${naechte === 1 ? 'Nacht' : 'Nächte'}` : '',
      zeitraum,
      v.ort || '',
    ].filter(Boolean).join(' · ')
    : '';

  const details = [];
  if (erste) details.push(erste);
  if (r.buchungsnummer) {
    details.push(r.portal
      ? `Buchung ${r.buchungsnummer} über ${r.portal}`
      : `Buchungsnummer ${r.buchungsnummer}`);
  }

  return {
    auto: true,
    titel: `Übernachtung im ${v.objekt || 'Apartment'}`,
    details,
    menge: naechte || 1,
    einheit: naechte ? (naechte === 1 ? 'Nacht' : 'Nächte') : '',
    // Ungerundet, damit Menge x Einzelpreis exakt den Gesamtpreis ergibt.
    einzelpreis: naechte ? gesamt / naechte : gesamt,
  };
}
