import unittest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from matcher.scorer import _count_matches, _date_timestamp, _has_any


class ScorerKeywordTest(unittest.TestCase):
    def test_short_ai_keyword_is_word_bounded(self):
        self.assertEqual(_count_matches("supply chain analyst", ["AI"]), 0)
        self.assertFalse(_has_any("supply chain analyst", ["AI"]))
        self.assertEqual(_count_matches("AI research assistant", ["AI"]), 1)

    def test_rss_style_dates_are_sortable(self):
        self.assertGreater(_date_timestamp("Sat, 30 May 2026 08:00:00 GMT"), 0)


if __name__ == "__main__":
    unittest.main()
