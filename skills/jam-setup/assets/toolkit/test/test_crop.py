import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from PIL import Image  # noqa: E402
from crop_turnaround import crop, side_facing, VIEWS  # noqa: E402


def figure_sheet(right_mirrored=True):
    """Five 7x9 cells on a flat background, each with a figure that faces screen left;
    the right view faces screen right unless right_mirrored is false."""
    image = Image.new("RGBA", (35, 9), (180, 180, 190, 255))
    for i in range(5):
        for y in range(1, 8):
            for x in range(1, 4 if y > 2 else 6):
                cx = 6 - x if i == 3 and right_mirrored else x
                image.putpixel((i * 7 + cx, y), (x * 30, y * 23, 40 + i * 9, 120 + x * 20))
    return image


def symmetric_sheet():
    """Five cells of a figure that looks the same from every side."""
    image = Image.new("RGB", (35, 9), (180, 180, 190))
    for i in range(5):
        for y in range(1, 8):
            for x in range(2, 5):
                image.putpixel((i * 7 + x, y), (60, 40 + y * 10, 30))
    return image


class TurnaroundCropTests(unittest.TestCase):
    def test_five_equal_cells_preserve_pixels_alpha_and_source(self):
        with tempfile.TemporaryDirectory(prefix="jam crop ") as temp:
            root = Path(temp)
            source = root / "sheet.png"
            image = figure_sheet()
            image.save(source)
            before = source.read_bytes()
            layout = {name: [i * 7, 0, 7, 9] for i, name in enumerate(VIEWS)}
            report = crop(source, layout, root / "output")
            self.assertEqual(report["visualReview"], "pending")
            self.assertFalse(report["symmetric"])
            self.assertGreater(report["sideFacing"]["mirrored"], report["sideFacing"]["asDrawn"])
            self.assertEqual(source.read_bytes(), before)
            for i, name in enumerate(VIEWS):
                with Image.open(root / "output" / f"{name}.png") as view:
                    self.assertEqual(view.size, (7, 9))
                    for y in range(9):
                        for x in range(7):
                            self.assertEqual(view.getpixel((x, y)), image.getpixel((x + i * 7, y)))
            with self.assertRaisesRegex(ValueError, "output exists"):
                crop(source, layout, root / "output")

    def test_invalid_boxes_never_create_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "sheet.png"
            Image.new("RGB", (50, 10)).save(source)
            good = {name: [i * 10, 0, 10, 10] for i, name in enumerate(VIEWS)}
            for box, message in [([40, 0, 11, 10], "outside"), ([40, 0, 9, 10], "equal"), ([0, 0, 10, 10], "overlap")]:
                with self.subTest(box=box):
                    layout = dict(good, **{"three-quarter": box})
                    with self.assertRaisesRegex(ValueError, message):
                        crop(source, layout, root / "output")
                    self.assertFalse((root / "output").exists())

    def test_sides_facing_the_same_way_never_create_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "sheet.png"
            figure_sheet(right_mirrored=False).save(source)
            layout = {name: [i * 7, 0, 7, 9] for i, name in enumerate(VIEWS)}
            with self.assertRaisesRegex(ValueError, "face the same way"):
                crop(source, layout, root / "output")
            self.assertFalse((root / "output").exists())

    def test_a_declared_symmetric_subject_may_show_identical_sides_and_reuse_one_view(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "sheet.png"
            symmetric_sheet().save(source)
            layout = {name: [i * 7, 0, 7, 9] for i, name in enumerate(VIEWS)}
            # Undeclared, identical sides look like two views facing the same way.
            with self.assertRaisesRegex(ValueError, "--symmetric"):
                crop(source, layout, root / "undeclared")
            report = crop(source, layout, root / "declared", symmetric=True)
            self.assertTrue(report["symmetric"])
            # One side view may stand for both sides, which would otherwise be an overlap.
            reused = dict(layout, right=layout["left"])
            with self.assertRaisesRegex(ValueError, "overlap"):
                crop(source, reused, root / "reused-undeclared")
            report = crop(source, reused, root / "reused", symmetric=True)
            self.assertEqual(report["views"]["left"]["sha256"], report["views"]["right"]["sha256"])

    def test_facing_of_two_views_is_reported_without_cropping(self):
        sheet = figure_sheet()
        left, right = sheet.crop((7, 0, 14, 9)), sheet.crop((21, 0, 28, 9))
        facing = side_facing(left, right)
        self.assertGreater(facing["mirrored"], facing["asDrawn"])


if __name__ == "__main__":
    unittest.main()
