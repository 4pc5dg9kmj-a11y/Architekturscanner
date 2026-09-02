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
  const erste = [
    `${naechte} ${naechte === 1 ? 'Nacht' : 'Nächte'}`,
    zeitraum,
    ort,
  ].filter(Boolean).join(' · ');
  details.push(erste);
  if (r.buchungsnummer) {
    details.push(r.portal
      ? `Buchung ${r.buchungsnummer} über ${r.portal}`
      : `Buchungsnummer ${r.buchungsnummer}`);
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
