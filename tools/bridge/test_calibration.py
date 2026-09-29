"""Unit conversions between simulation radians and LeRobot SO-101 units (GAME_DESIGN 5.7)."""

import json
import math
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from calibration import JOINT_NAMES, SO101_RANGES, Calibration, lerobot_to_sim, sim_to_lerobot  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GUARD = [0.0, -0.62, 1.08, -0.48, 0.0, 1.15]


class CalibrationTest(unittest.TestCase):
    def test_ranges_match_so101_xml(self):
        with open(os.path.join(ROOT, "public/models/robotstudio_so101/so101.xml"), encoding="utf-8") as fh:
            xml = fh.read()
        for name in JOINT_NAMES:
            m = re.search(r'<joint[^>]*name="%s"[^>]*range="([-\d.]+) ([-\d.]+)"' % name, xml)
            self.assertIsNotNone(m, name)
            self.assertEqual(SO101_RANGES[name], (float(m.group(1)), float(m.group(2))))

    def test_zero_pose_documented_values(self):
        # docs/HARNESS.md "Calibration": MJCF zero pose.
        self.assertEqual(sim_to_lerobot([0] * 6)[:5], [0.0] * 5)
        self.assertAlmostEqual(sim_to_lerobot([0] * 6)[5], 9.0909, places=4)
        self.assertEqual(sim_to_lerobot([0] * 6, "degrees")[:5], [0.0] * 5)

    def test_guard_pose_documented_values(self):
        v = sim_to_lerobot(GUARD, "range_m100_100")
        for got, want in zip(v, [0.0, -35.5234, 63.9053, -28.9494, 0.0, 68.9910]):
            self.assertAlmostEqual(got, want, places=4)
        d = sim_to_lerobot(GUARD, "degrees")
        for got, want in zip(d, [0.0, -35.5234, 61.8794, -27.5020, 0.0, 68.9910]):
            self.assertAlmostEqual(got, want, places=4)

    def test_limits_map_to_range_ends(self):
        lo = [SO101_RANGES[n][0] for n in JOINT_NAMES]
        hi = [SO101_RANGES[n][1] for n in JOINT_NAMES]
        for got in sim_to_lerobot(lo)[:5]:
            self.assertAlmostEqual(got, -100.0, places=9)
        for got in sim_to_lerobot(hi)[:5]:
            self.assertAlmostEqual(got, 100.0, places=9)
        self.assertAlmostEqual(sim_to_lerobot(lo)[5], 0.0, places=9)
        self.assertAlmostEqual(sim_to_lerobot(hi)[5], 100.0, places=9)

    def test_round_trip_every_mode(self):
        for units in ("rad", "degrees", "range_m100_100"):
            back = lerobot_to_sim(sim_to_lerobot(GUARD, units), units)
            for a, b in zip(back, GUARD):
                self.assertAlmostEqual(a, b, places=12)

    def test_measured_calibration_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "arm.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"elbow_flex": [-1.5, 1.7]}, fh)
            cal = Calibration.from_json(path)
        self.assertEqual(cal.range("elbow_flex"), (-1.5, 1.7))
        self.assertEqual(cal.range("wrist_roll"), SO101_RANGES["wrist_roll"])
        self.assertAlmostEqual(cal.sim_to_lerobot([0, 0, 0.1, 0, 0, 0])[2], 0.0, places=12)

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            sim_to_lerobot([0] * 5)
        with self.assertRaises(ValueError):
            sim_to_lerobot([0] * 6, "ticks")
        with self.assertRaises(ValueError):
            Calibration({"gripper": (1.0, 1.0)})
        with self.assertRaises(ValueError):
            Calibration({"elbow": (0.0, 1.0)})
        self.assertTrue(math.isfinite(sim_to_lerobot(GUARD)[1]))


if __name__ == "__main__":
    unittest.main()
