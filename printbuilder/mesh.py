"""Dreiecksnetz-Werkzeuge und Export nach STL / 3MF / OBJ.

Alle Flaechen werden mit nach aussen zeigenden Normalen und der Reihenfolge
gegen den Uhrzeigersinn (von aussen gesehen) erzeugt - so erwarten es Slicer.
Einheit ist durchgaengig Millimeter.
"""

from __future__ import annotations

import io
import struct
import zipfile
from datetime import datetime, timezone

import numpy as np


class Mesh:
    """Sammlung von Dreiecken (N, 3, 3) in mm."""

    def __init__(self) -> None:
        self._parts: list[np.ndarray] = []

    # ---- Bausteine -------------------------------------------------------
    def add_triangles(self, tris: np.ndarray) -> None:
        tris = np.asarray(tris, dtype=np.float32).reshape(-1, 3, 3)
        if tris.size:
            self._parts.append(tris)

    def add_quads(self, p0: np.ndarray, p1: np.ndarray,
                  p2: np.ndarray, p3: np.ndarray) -> None:
        """Vierecke (p0,p1,p2,p3) gegen den Uhrzeigersinn -> je 2 Dreiecke."""
        p0, p1, p2, p3 = (np.asarray(p, dtype=np.float32).reshape(-1, 3)
                          for p in (p0, p1, p2, p3))
        self.add_triangles(np.stack([p0, p1, p2], axis=1))
        self.add_triangles(np.stack([p0, p2, p3], axis=1))

    def add_box(self, x0: float, y0: float, z0: float,
                x1: float, y1: float, z1: float) -> None:
        """Achsenparalleler Quader; leere Quader werden ignoriert."""
        if not (x1 > x0 and y1 > y0 and z1 > z0):
            return
        v000 = (x0, y0, z0); v100 = (x1, y0, z0)
        v110 = (x1, y1, z0); v010 = (x0, y1, z0)
        v001 = (x0, y0, z1); v101 = (x1, y0, z1)
        v111 = (x1, y1, z1); v011 = (x0, y1, z1)
        for quad in (
            (v000, v010, v110, v100),   # unten  (-z)
            (v001, v101, v111, v011),   # oben   (+z)
            (v000, v100, v101, v001),   # vorn   (-y)
            (v100, v110, v111, v101),   # rechts (+x)
            (v110, v010, v011, v111),   # hinten (+y)
            (v010, v000, v001, v011),   # links  (-x)
        ):
            a, b, c, d = (np.array(v, dtype=np.float32) for v in quad)
            self.add_quads(a, b, c, d)

    def add_frame(self, x0: float, y0: float, x1: float, y1: float,
                  margin: float, z0: float, z1: float) -> None:
        """Geschlossener Rahmenring der Breite ``margin`` (ein Koerper).

        Bewusst *ein* Ring statt vier Quader: aneinanderstossende Quader teilen
        sich Eckpunkte, wodurch Kanten an vier Dreiecken haengen. Slicer stoert
        das nicht, strenge Pruefwerkzeuge melden es aber als fehlerhaft.
        """
        if not (x1 - x0 > 2 * margin and y1 - y0 > 2 * margin and z1 > z0
                and margin > 0):
            return
        outer = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        inner = [(x0 + margin, y0 + margin), (x1 - margin, y0 + margin),
                 (x1 - margin, y1 - margin), (x0 + margin, y1 - margin)]

        def p(xy, z):
            return np.array([xy[0], xy[1], z], dtype=np.float32)

        for k in range(4):
            k2 = (k + 1) % 4
            o, o2, i, i2 = outer[k], outer[k2], inner[k], inner[k2]
            # Aussenwand (nach aussen), Innenwand (zur Oeffnung hin)
            self.add_quads(p(o, z0), p(o2, z0), p(o2, z1), p(o, z1))
            self.add_quads(p(i, z0), p(i, z1), p(i2, z1), p(i2, z0))
            # Deckflaeche oben (+z) und Boden unten (-z)
            self.add_quads(p(o, z1), p(o2, z1), p(i2, z1), p(i, z1))
            self.add_quads(p(o, z0), p(i, z0), p(i2, z0), p(o2, z0))

    def add_ribbon(self, pts: np.ndarray, width: np.ndarray, height: np.ndarray,
                   z_bottom: float) -> None:
        """Geschlossener Steg entlang eines Polygonzugs.

        Der Querschnitt ist ein Rechteck ``width`` x (``height`` - ``z_bottom``),
        das an jedem Stuetzpunkt neu vermessen wird. Ergebnis ist ein
        wasserdichter Koerper (Mantel + zwei Deckel).
        """
        pts = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
        if pts.shape[0] < 2:
            return
        width = np.asarray(width, dtype=np.float64).reshape(-1)
        height = np.asarray(height, dtype=np.float64).reshape(-1)

        # Doppelte Punkte entfernen - sie wuerden Nulldreiecke erzeugen
        keep = np.ones(pts.shape[0], dtype=bool)
        keep[1:] = np.abs(np.diff(pts, axis=0)).max(axis=1) > 1e-9
        pts, width, height = pts[keep], width[keep], height[keep]
        if pts.shape[0] < 2:
            return

        tangent = np.zeros_like(pts)
        tangent[1:-1] = pts[2:] - pts[:-2]
        tangent[0] = pts[1] - pts[0]
        tangent[-1] = pts[-1] - pts[-2]
        norm = np.linalg.norm(tangent, axis=1, keepdims=True)
        tangent = tangent / np.maximum(norm, 1e-12)
        normal = np.stack([-tangent[:, 1], tangent[:, 0]], axis=1)

        half = (width * 0.5)[:, None]
        left = pts - normal * half
        right = pts + normal * half
        zb = np.full((pts.shape[0], 1), float(z_bottom))
        zt = height[:, None]

        ring = np.stack([                       # gegen den Uhrzeigersinn
            np.concatenate([left, zb], axis=1),   # A: unten aussen
            np.concatenate([right, zb], axis=1),  # B: unten innen
            np.concatenate([right, zt], axis=1),  # C: oben innen
            np.concatenate([left, zt], axis=1),   # D: oben aussen
        ], axis=1).astype(np.float32)             # (N, 4, 3)

        for k in range(4):
            k2 = (k + 1) % 4
            self.add_quads(ring[:-1, k], ring[:-1, k2], ring[1:, k2], ring[1:, k])

        start, end = ring[0], ring[-1]
        self.add_quads(start[0], start[3], start[2], start[1])   # Deckel hinten
        self.add_quads(end[0], end[1], end[2], end[3])           # Deckel vorn

    # ---- Auswertung ------------------------------------------------------
    def triangles(self) -> np.ndarray:
        if not self._parts:
            return np.zeros((0, 3, 3), dtype=np.float32)
        if len(self._parts) > 1:
            self._parts = [np.concatenate(self._parts, axis=0)]
        return self._parts[0]

    def __len__(self) -> int:
        return int(sum(part.shape[0] for part in self._parts))

    def translate(self, dx: float = 0.0, dy: float = 0.0, dz: float = 0.0) -> None:
        shift = np.array([dx, dy, dz], dtype=np.float32)
        self._parts = [part + shift for part in self._parts]

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        tris = self.triangles()
        if not tris.size:
            zero = np.zeros(3, dtype=np.float32)
            return zero, zero
        flat = tris.reshape(-1, 3)
        return flat.min(axis=0), flat.max(axis=0)

    def signed_volume_mm3(self) -> float:
        """Volumen ueber das Divergenztheorem.

        Bei einander durchdringenden Koerpern (Steg in Platte) wird der
        Ueberschneidungsbereich doppelt gezaehlt - fuer die Materialschaetzung
        wird deshalb das gerasterte Hoehenfeld verwendet, nicht dieser Wert.
        """
        tris = self.triangles().astype(np.float64)
        if not tris.size:
            return 0.0
        a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
        return float(np.abs(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def to_stl(mesh: Mesh, name: str = "Linien-Relief") -> bytes:
    """Binaeres STL."""
    tris = mesh.triangles().astype(np.float32)
    count = tris.shape[0]

    normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.divide(normals, np.maximum(lengths, 1e-20)).astype(np.float32)

    record = np.zeros(count, dtype=np.dtype([
        ("normal", "<f4", 3), ("v", "<f4", (3, 3)), ("attr", "<u2"),
    ]))
    record["normal"] = normals
    record["v"] = tris

    out = io.BytesIO()
    out.write(name.encode("ascii", "replace")[:79].ljust(80, b"\0"))
    out.write(struct.pack("<I", count))
    out.write(record.tobytes())
    return out.getvalue()


def to_obj(mesh: Mesh, name: str = "Linien-Relief") -> bytes:
    """Wavefront-OBJ (Einheit mm), mit zusammengefassten Eckpunkten."""
    verts, faces = _weld(mesh)
    out = io.BytesIO()
    out.write(f"# {name} - Architekturscanner Linien-Relief\n".encode())
    out.write(b"# Einheit: Millimeter\n")
    np.savetxt(out, verts, fmt="v %.4f %.4f %.4f")
    np.savetxt(out, faces + 1, fmt="f %d %d %d")
    return out.getvalue()


def to_3mf(mesh: Mesh, name: str = "Linien-Relief") -> bytes:
    """3MF - kompakter als STL und bringt die Einheit mm selbst mit."""
    verts, faces = _weld(mesh)

    vert_xml = "\n".join(
        f'    <vertex x="{x:.4f}" y="{y:.4f}" z="{z:.4f}"/>' for x, y, z in verts)
    tri_xml = "\n".join(
        f'    <triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in faces)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    model = f"""<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE"
       xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">{_xml_escape(name)}</metadata>
  <metadata name="Application">Architekturscanner Linien-Relief</metadata>
  <metadata name="CreationDate">{stamp}</metadata>
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
{vert_xml}
        </vertices>
        <triangles>
{tri_xml}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>
"""
    rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rel0" Target="/3D/3dmodel.model"
      Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
"""
    content_types = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels"
      ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model"
      ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("3D/3dmodel.model", model)
    return buf.getvalue()


def _weld(mesh: Mesh, decimals: int = 4) -> tuple[np.ndarray, np.ndarray]:
    """Gleiche Eckpunkte zusammenfassen -> (Punkte, Dreiecksindizes)."""
    tris = mesh.triangles().astype(np.float64).reshape(-1, 3)
    if not tris.size:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    rounded = np.round(tris, decimals)
    _, first, inverse = np.unique(rounded, axis=0, return_index=True,
                                  return_inverse=True)
    # np.unique liefert die eindeutigen Zeilen sortiert; `inverse` zeigt genau
    # in diese Reihenfolge, also muss die Punktliste ebenso sortiert bleiben.
    return tris[first], np.asarray(inverse).reshape(-1, 3)


def _xml_escape(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))


EXPORTERS = {"stl": to_stl, "3mf": to_3mf, "obj": to_obj}
MEDIA_TYPES = {
    "stl": "model/stl",
    "3mf": "model/3mf",
    "obj": "text/plain",
}
