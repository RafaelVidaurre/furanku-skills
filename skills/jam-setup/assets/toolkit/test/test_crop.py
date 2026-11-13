import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from PIL import Image
from crop_turnaround import crop, VIEWS


class TurnaroundCropTests(unittest.TestCase):
    def test_five_equal_cells_preserve_pixels_alpha_and_source(self):
        with tempfile.TemporaryDirectory(prefix="jam crop ") as temp:
            root = Path(temp)
            source = root / "sheet.png"
            image = Image.new("RGBA", (35, 9))
            for y in range(image.height):
                for x in range(image.width):
                    image.putpixel((x, y), (x * 7, y * 23, (x + y) * 5, 80 + x * 3))
            image.save(source)
            before = source.read_bytes()
            layout = {name: [i * 7, 0, 7, 9] for i, name in enumerate(VIEWS)}
            report = crop(source, layout, root / "output")
            self.assertEqual(report["visualReview"], "pending")
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


if __name__ == "__main__":
    unittest.main()
