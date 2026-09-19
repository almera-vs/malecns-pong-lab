"""Verify annotation retention and explicit uncertainty in conversion helpers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_runtime import fast_sign, first, position8nm  # noqa: E402


class AnnotationNormalizationTests(unittest.TestCase):
    def test_blank_preferred_side_falls_back_to_published_root_side(self) -> None:
        self.assertEqual(first({"side": "", "rootSide": "R"}, "side", "rootSide"), "R")

    def test_missing_soma_is_not_fabricated_as_origin(self) -> None:
        self.assertIsNone(position8nm({"bodyId": 42}))
        self.assertIsNone(position8nm({"soma_x": 10, "soma_y": 20}))

    def test_published_soma_location_is_preserved(self) -> None:
        self.assertEqual(position8nm({"somaLocation": [1, 2, 3]}), [1.0, 2.0, 3.0])

    def test_transmitter_sign_stays_unknown_without_receptor_polarity(self) -> None:
        self.assertEqual(fast_sign("acetylcholine"), 1)
        self.assertEqual(fast_sign("GABA"), -1)
        self.assertEqual(fast_sign("histamine", "ol_sensory"), -1)
        self.assertEqual(fast_sign("histamine", "other"), 0)
        self.assertEqual(fast_sign("glutamate"), 0)
        self.assertEqual(fast_sign("glycine"), 0)


if __name__ == "__main__":
    unittest.main()
