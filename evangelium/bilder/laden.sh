#!/usr/bin/env bash
# Lädt die Gemälde der Ausstellung von Wikimedia Commons (alle gemeinfrei)
# in diesen Ordner. Aufruf: bash evangelium/bilder/laden.sh
set -euo pipefail
cd "$(dirname "$0")"
BREITE=1400
while IFS='|' read -r ziel datei; do
  [ -z "$ziel" ] && continue
  if [ -s "$ziel" ]; then echo "vorhanden: $ziel"; continue; fi
  url="https://commons.wikimedia.org/wiki/Special:FilePath/$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$datei")?width=$BREITE"
  echo "lade:      $ziel"
  curl -fsSL -A "Evangelium-Galerie/1.0 (Bildarchiv)" "$url" -o "$ziel" || { echo "FEHLER:    $datei"; rm -f "$ziel"; }
done <<'LISTE'
01-love.jpg|Michelangelo_-_Creation_of_Adam_(cropped).jpg
02-gap.jpg|Masaccio-TheExpulsionOfAdamAndEveFromEden-Restoration.jpg
03-fall.jpg|Arnold_Böcklin_-_Die_Toteninsel_III_(Alte_Nationalgalerie,_Berlin).jpg
04-beam.jpg|Gerard_van_Honthorst_-_Adoration_of_the_Shepherds_(1622).jpg
05-cross.jpg|Cristo_crucificado.jpg
06-tomb.jpg|Grunewald_Isenheim1.jpg
07-gift.jpg|Rembrandt_Harmensz_van_Rijn_-_Return_of_the_Prodigal_Son_-_Google_Art_Project.jpg
08-turn.jpg|The_Calling_of_Saint_Matthew-Caravaggio_(1599-1600).jpg
09-dawn.jpg|Conversion_on_the_Way_to_Damascus-Caravaggio_(c.1600-1).jpg
10-door.jpg|The_Light_of_the_World_(painting).jpg
LISTE
