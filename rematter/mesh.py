"""Dependency-free polygon extrusion and basic mesh checks.

Cross-section coordinates are XY millimetres and extrusion is along +Z.
Only simple, counter-clockwise polygons without holes or collinear corners
are accepted. ``watertight`` checks edge incidence, not self-intersection of
arbitrary supplied triangle meshes. STL itself has no unit metadata.
"""
from collections import Counter, defaultdict
from math import fsum, hypot, isfinite
from pathlib import Path
import re

Point2 = tuple[float, float]
Vertex = tuple[float, float, float]
Triangle = tuple[Vertex, Vertex, Vertex]


def _cross2(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _cross3(a, b, c):
    u = tuple(b[i] - a[i] for i in range(3))
    v = tuple(c[i] - a[i] for i in range(3))
    value = (u[1] * v[2] - u[2] * v[1],
             u[2] * v[0] - u[0] * v[2],
             u[0] * v[1] - u[1] * v[0])
    if not all(isfinite(x) for x in value):
        raise ValueError("Triangle area exceeds finite numeric range")
    return value


def _point(values, dimension):
    try:
        result = tuple(float(v) for v in values)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Coordinates must be finite numbers") from exc
    if len(result) != dimension or not all(isfinite(v) for v in result):
        raise ValueError(f"Each point must have {dimension} finite coordinates")
    return result


def _segments_intersect(a, b, c, d, linear_eps, area_eps):
    def on_segment(p, q, r):
        return (min(p[0], q[0]) - linear_eps <= r[0] <= max(p[0], q[0]) + linear_eps
                and min(p[1], q[1]) - linear_eps <= r[1] <= max(p[1], q[1]) + linear_eps)

    turns = (_cross2(a, b, c), _cross2(a, b, d), _cross2(c, d, a), _cross2(c, d, b))
    o1, o2, o3, o4 = turns
    if ((o1 > area_eps and o2 < -area_eps) or (o1 < -area_eps and o2 > area_eps)) and (
        (o3 > area_eps and o4 < -area_eps) or (o3 < -area_eps and o4 > area_eps)
    ):
        return True
    return any((abs(o) <= area_eps and on_segment(p, q, r))
               for o, p, q, r in ((o1, a, b, c), (o2, a, b, d),
                                  (o3, c, d, a), (o4, c, d, b)))


def _validated_polygon(points):
    points = [_point(p, 2) for p in points]
    if len(points) < 3:
        raise ValueError("A polygon requires at least three vertices")
    extent = max(max(p[i] for p in points) - min(p[i] for p in points) for i in range(2))
    if not isfinite(extent) or extent <= 0:
        raise ValueError("Polygon must have a finite nonzero extent")
    linear_eps = 1e-12 * extent
    area_eps = linear_eps * extent
    if not isfinite(area_eps) or area_eps == 0:
        raise ValueError("Polygon scale is outside the supported numeric range")
    for i, a in enumerate(points):
        for b in points[i + 1:]:
            if hypot(a[0] - b[0], a[1] - b[1]) <= linear_eps:
                raise ValueError("Duplicate or numerically coincident polygon vertices")
    n = len(points)
    for i in range(n):
        for j in range(i + 1, n):
            if (i + 1) % n == j or (j + 1) % n == i:
                continue
            if _segments_intersect(points[i], points[(i + 1) % n],
                                   points[j], points[(j + 1) % n], linear_eps, area_eps):
                raise ValueError("Polygon is self-intersecting")
    origin = points[0]
    area2 = fsum((points[i][0] - origin[0]) * (points[(i + 1) % n][1] - origin[1])
                 - (points[(i + 1) % n][0] - origin[0]) * (points[i][1] - origin[1])
                 for i in range(n))
    if not isfinite(area2) or area2 <= area_eps:
        raise ValueError("Polygon must have positive area and counter-clockwise winding")
    for i in range(n):
        if abs(_cross2(points[i - 1], points[i], points[(i + 1) % n])) <= area_eps:
            raise ValueError("Collinear or numerically degenerate polygon corner")
    return points, area_eps


def _triangulate(points, eps):
    remaining = list(range(len(points)))
    triangles = []
    while len(remaining) > 3:
        for offset, current in enumerate(remaining):
            previous = remaining[offset - 1]
            following = remaining[(offset + 1) % len(remaining)]
            a, b, c = points[previous], points[current], points[following]
            if _cross2(a, b, c) <= eps:
                continue
            # Points on a prospective ear's boundary also prevent clipping.
            # This avoids a diagonal passing through another polygon vertex.
            occupied = any(
                _cross2(a, b, points[j]) >= -eps
                and _cross2(b, c, points[j]) >= -eps
                and _cross2(c, a, points[j]) >= -eps
                for j in remaining if j not in (previous, current, following)
            )
            if not occupied:
                triangles.append((previous, current, following))
                remaining.pop(offset)
                break
        else:
            raise ValueError("Polygon cannot be robustly triangulated")
    if _cross2(*(points[i] for i in remaining)) <= eps:
        raise ValueError("Degenerate final cap triangle")
    triangles.append(tuple(remaining))
    return triangles


def extrude_polygon(points, length_mm) -> list[Triangle]:
    """Extrude a simple CCW polygon into an outward-oriented closed mesh.

    Repeated closing vertices, clockwise winding, self-intersections,
    collinear corners, non-finite values and nonpositive lengths are rejected.
    """
    try:
        length = float(length_mm)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError("Extrusion length must be finite and positive") from exc
    if not isfinite(length) or length <= 0:
        raise ValueError("Extrusion length must be finite and positive")
    points, eps = _validated_polygon(points)
    bottom = [(x, y, 0.0) for x, y in points]
    top = [(x, y, length) for x, y in points]
    result = []
    for a, b, c in _triangulate(points, eps):
        result.append((bottom[a], bottom[c], bottom[b]))
        result.append((top[a], top[b], top[c]))
    for i in range(len(points)):
        j = (i + 1) % len(points)
        result.append((bottom[i], bottom[j], top[j]))
        result.append((bottom[i], top[j], top[i]))
    for triangle in result:
        if hypot(*_cross3(*triangle)) == 0:
            raise ValueError("Extrusion produced a numerically degenerate triangle")
    return result


def _validated_triangles(triangles):
    result = []
    for triangle in triangles:
        triangle = tuple(_point(p, 3) for p in triangle)
        if len(triangle) != 3:
            raise ValueError("Each triangle must have three vertices")
        result.append(triangle)
    if not result:
        raise ValueError("Mesh must contain at least one triangle")
    return result


def mesh_metrics(triangles) -> dict:
    """Return geometry checks; signed volume is meaningful for closed meshes.

    Edge-incidence closure does not detect arbitrary triangle intersections.
    Positive volume and consistent winding are separate from closure.
    """
    triangles = _validated_triangles(triangles)
    edges = Counter()
    directions = defaultdict(int)
    degenerate = 0
    terms = []
    origin = triangles[0][0]
    for triangle in triangles:
        if hypot(*_cross3(*triangle)) == 0:
            degenerate += 1
        translated = [tuple(p[i] - origin[i] for i in range(3)) for p in triangle]
        a, b, c = translated
        bc = (b[1] * c[2] - b[2] * c[1],
              b[2] * c[0] - b[0] * c[2],
              b[0] * c[1] - b[1] * c[0])
        terms.append(fsum(a[i] * bc[i] for i in range(3)) / 6.0)
        for i in range(3):
            first, second = triangle[i], triangle[(i + 1) % 3]
            edge = tuple(sorted((first, second)))
            edges[edge] += 1
            directions[edge] += 1 if (first, second) == edge else -1
    volume = fsum(terms)
    if not isfinite(volume):
        raise ValueError("Mesh volume exceeds finite numeric range")
    vertices = [p for triangle in triangles for p in triangle]
    closed = all(count == 2 for count in edges.values()) and degenerate == 0
    return {
        "signed_volume_mm3": volume,
        "watertight": closed,
        "orientation_consistent": closed and all(v == 0 for v in directions.values()),
        "triangle_count": len(triangles),
        "degenerate_triangle_count": degenerate,
        "bounds_mm": [[min(p[i] for p in vertices) for i in range(3)],
                      [max(p[i] for p in vertices) for i in range(3)]],
    }


def write_ascii_stl(path, triangles, name="rematter") -> None:
    """Write finite, nondegenerate triangles without changing their winding."""
    triangles = _validated_triangles(triangles)
    facets = []
    for triangle in triangles:
        normal = _cross3(*triangle)
        magnitude = hypot(*normal)
        if magnitude == 0 or not isfinite(magnitude):
            raise ValueError("Cannot write a degenerate triangle")
        facets.append((tuple(v / magnitude for v in normal), triangle))
    name = re.sub(r"[^A-Za-z0-9_.-]", "_", str(name)) or "rematter"
    lines = [f"solid {name}"]
    for normal, triangle in facets:
        lines.append("  facet normal " + " ".join(format(v, ".17g") for v in normal))
        lines.append("    outer loop")
        for point in triangle:
            lines.append("      vertex " + " ".join(format(v, ".17g") for v in point))
        lines.extend(("    endloop", "  endfacet"))
    lines.append(f"endsolid {name}")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="ascii")
