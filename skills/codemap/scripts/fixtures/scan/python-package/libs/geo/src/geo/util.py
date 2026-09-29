import numpy as np
from .base import Point  # sibling module
from .shapes import Circle
from .shapes.polygon import Polygon
from geo.base import Point as P2


def area(p: Point) -> float:
    return np.pi * p.norm() * (Circle, Polygon, P2)
