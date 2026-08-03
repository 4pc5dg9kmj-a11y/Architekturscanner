"""Fahrradhaeuschen-Planer.

Parametrischer Planer fuer ein Fahrradhaeuschen mit Geraeteraum und Pultdach,
das in Hessen verfahrensfrei direkt an der Grundstuecksgrenze stehen darf.

Aufbau der Module:

``spec``          Eingabeparameter und feste Konstruktionsmasse
``statics``       Schnee- und Eigenlasten, Sparrennachweis nach EC5
``model``         parametrisches Bauwerk: jedes Holz mit Lage und Querschnitt
``compliance``    Pruefung nach HBO und Optimierer fuer die groesste Variante
``bom``           Holzliste, Zuschnittoptimierung, Schrauben und Werkstoffe
``drawings``      2D-Zeichnungssatz als Entitaetenliste
``instructions``  Bauanleitung, Werkzeugliste, Wartung
``pdf``           Zeichnungsblaetter A3 und Listen/Anleitung A4
``dxf``           DXF-Export des Zeichnungssatzes
``text``          zentrale deutsche Schreibweise aller Ausgaben
``api``           Nutzlast fuer die Weboberflaeche
"""

from .spec import ShedSpec

__all__ = ["ShedSpec"]
