"""Foto -> 3D-Druckdatei: Platte mit modulierten Linien ("Linien-Relief").

Ein Foto wird in eine Schar paralleler Linien uebersetzt. Jede Linie wird je
nach Helligkeit des Bildes seitlich ausgelenkt, dicker/duenner und
hoeher/niedriger. Aus etwas Abstand ergibt sich daraus wieder das Motiv.
Ausgegeben wird ein druckfertiges Mesh (STL / 3MF / OBJ).
"""

from .params import ReliefParams, PRESETS
from .builder import BuildResult, build_relief, build_mesh

__all__ = [
    "ReliefParams",
    "PRESETS",
    "BuildResult",
    "build_relief",
    "build_mesh",
]
