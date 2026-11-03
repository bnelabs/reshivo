import math
from pathlib import Path
import tempfile
import unittest

from reshivo.mesh import extrude_polygon, mesh_metrics, write_ascii_stl


RECTANGLE = [(0, 0), (4, 0), (4, 6), (0, 6)]
I_SECTION = [(-10, -15), (10, -15), (10, -10), (2, -10),
             (2, 10), (10, 10), (10, 15), (-10, 15),
             (-10, 10), (-2, 10), (-2, -10), (-10, -10)]


def cap_area(triangle):
    a, b, c = triangle
    return ((b[0] - a[0]) * (c[1] - a[1])
            - (b[1] - a[1]) * (c[0] - a[0])) / 2


def inside_polygon(point, polygon):
    """Independent ray-crossing test used on cap triangle centroids."""
    x, y = point
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > y) != (y2 > y):
            crossing = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < crossing:
                inside = not inside
        previous = current
    return inside


def parse_ascii_vertices(path):
    """Small test-only STL reader independent of the writer implementation."""
    triangles = []
    current = []
    for line in path.read_text(encoding="ascii").splitlines():
        fields = line.split()
        if fields and fields[0] == "vertex":
            if len(fields) != 4:
                raise AssertionError("Malformed vertex record")
            current.append(tuple(float(v) for v in fields[1:]))
        elif fields and fields[0] == "endfacet":
            if len(current) != 3:
                raise AssertionError("Malformed facet")
            triangles.append(tuple(current))
            current = []
    if current:
        raise AssertionError("Incomplete final facet")
    return triangles


class MeshTests(unittest.TestCase):
    def assert_closed(self, triangles, volume, bounds):
        metrics = mesh_metrics(triangles)
        self.assertTrue(metrics["watertight"])
        self.assertTrue(metrics["orientation_consistent"])
        self.assertEqual(metrics["degenerate_triangle_count"], 0)
        self.assertAlmostEqual(metrics["signed_volume_mm3"], volume, places=8)
        self.assertEqual(metrics["bounds_mm"], bounds)

    def test_rectangle_extrusion_geometry(self):
        triangles = extrude_polygon(RECTANGLE, 10)
        self.assertEqual(len(triangles), 12)
        self.assert_closed(triangles, 240, [[0, 0, 0], [4, 6, 10]])

    def test_concave_i_section_caps_and_volume(self):
        triangles = extrude_polygon(I_SECTION, 100)
        self.assertEqual(len(triangles), 44)
        # Two 20x5 flanges and a 4x20 web, extruded by 100 mm.
        self.assert_closed(triangles, 28000, [[-10, -15, 0], [10, 15, 100]])
        for z, expected_sign in ((0, -1), (100, 1)):
            caps = [t for t in triangles if all(p[2] == z for p in t)]
            self.assertEqual(len(caps), len(I_SECTION) - 2)
            self.assertAlmostEqual(sum(cap_area(t) for t in caps), expected_sign * 280)
            for triangle in caps:
                self.assertGreater(expected_sign * cap_area(triangle), 0)
                centroid = tuple(sum(p[i] for p in triangle) / 3 for i in range(2))
                self.assertTrue(inside_polygon(centroid, I_SECTION))

    def test_translated_rotated_section_roundtrips_ascii_stl(self):
        angle = 0.41
        polygon = [(1000 + math.cos(angle) * x - math.sin(angle) * y,
                    -2000 + math.sin(angle) * x + math.cos(angle) * y)
                   for x, y in I_SECTION]
        triangles = extrude_polygon(polygon, 123.456789)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "candidate.stl"
            write_ascii_stl(path, triangles, name="support\nnot_a_record")
            parsed = parse_ascii_vertices(path)
            self.assertEqual(parsed, triangles)
            self.assertEqual(len(path.read_text().split("\nsolid ")), 1)
        metrics = mesh_metrics(parsed)
        self.assertTrue(metrics["watertight"])
        self.assertTrue(metrics["orientation_consistent"])
        self.assertAlmostEqual(metrics["signed_volume_mm3"], 280 * 123.456789, places=6)

    def test_invalid_polygon_and_length_are_rejected(self):
        invalid_polygons = [
            list(reversed(RECTANGLE)),
            RECTANGLE + [RECTANGLE[0]],
            [(0, 0), (4, 0), (float("nan"), 4)],
            [(0, 0), (4, 0), (0, 3), (4, 3), (2, 4)],
            [(0, 0), (2, 0), (4, 0), (4, 6), (0, 6)],
            [(0, 0), (1, 1)],
            [(0, 0, 0), (4, 0), (4, 6)],
        ]
        for polygon in invalid_polygons:
            with self.subTest(polygon=polygon), self.assertRaises(ValueError):
                extrude_polygon(polygon, 10)
        for length in (0, -1, float("nan"), float("inf")):
            with self.subTest(length=length), self.assertRaises(ValueError):
                extrude_polygon(RECTANGLE, length)

    def test_metrics_detect_open_and_reversed_meshes(self):
        triangles = extrude_polygon(RECTANGLE, 10)
        self.assertFalse(mesh_metrics(triangles[:-1])["watertight"])
        reverse = [(a, c, b) for a, b, c in triangles]
        metrics = mesh_metrics(reverse)
        self.assertTrue(metrics["watertight"])
        self.assertTrue(metrics["orientation_consistent"])
        self.assertAlmostEqual(metrics["signed_volume_mm3"], -240)

    def test_degenerate_and_nonfinite_triangles(self):
        triangle = ((0, 0, 0), (1, 0, 0), (2, 0, 0))
        metrics = mesh_metrics([triangle])
        self.assertEqual(metrics["degenerate_triangle_count"], 1)
        self.assertFalse(metrics["watertight"])
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                write_ascii_stl(Path(folder) / "bad.stl", [triangle])
        with self.assertRaises(ValueError):
            mesh_metrics([((0, 0, 0), (1, 0, 0), (0, float("nan"), 0))])
        with self.assertRaises(ValueError):
            mesh_metrics([])


if __name__ == "__main__":
    unittest.main()
