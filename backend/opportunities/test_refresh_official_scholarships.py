import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from refresh_official_scholarships import (
    refresh_sources,
    is_candidate_link,
    Link,
)


SAMPLE_SOURCE = {
    "id": "erasmus_mundus",
    "label": "Erasmus Mundus catalogue",
    "url": "https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en",
    "domain": "eacea.ec.europa.eu",
    "fit": ["Europe", "masters", "fully funded"],
}


class OfficialScholarshipRefreshTest(unittest.TestCase):
    def test_candidate_link_filter_keeps_application_ready_links(self):
        self.assertTrue(is_candidate_link(
            SAMPLE_SOURCE,
            Link(
                url="https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-joint-master-ai-2026",
                text="Erasmus Mundus Joint Master in AI Scholarship 2026",
            ),
        ))
        self.assertFalse(is_candidate_link(
            SAMPLE_SOURCE,
            Link(
                url="https://www.eacea.ec.europa.eu/privacy",
                text="Privacy policy",
            ),
        ))

    def test_refresh_upserts_portal_and_listing_without_duplicates(self):
        html = """
        <html>
          <head><title>Erasmus catalogue</title></head>
          <body>
            <a href="/scholarships/erasmus-mundus-joint-master-ai-2026">
              Erasmus Mundus Joint Master in AI Scholarship 2026
            </a>
            <a href="/privacy">Privacy policy</a>
          </body>
        </html>
        """

        def fake_fetcher(_url):
            return html

        with tempfile.TemporaryDirectory() as tmp:
            db_path = os.path.join(tmp, "scholarships.db")
            first = refresh_sources(db_path, [SAMPLE_SOURCE], fake_fetcher, dry_run=False)
            second = refresh_sources(db_path, [SAMPLE_SOURCE], fake_fetcher, dry_run=False)

            self.assertEqual(first["records_ready"], 2)
            self.assertEqual(second["records_ready"], 2)

            db = sqlite3.connect(db_path)
            try:
                rows = db.execute(
                    "SELECT title, opportunity_type, source_site, is_verified FROM scholarships ORDER BY opportunity_type"
                ).fetchall()
            finally:
                db.close()

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][1], "official_portal")
        self.assertEqual(rows[0][2], "eacea.ec.europa.eu")
        self.assertEqual(rows[0][3], 1)
        self.assertEqual(rows[1][1], "scholarship")
        self.assertIn("AI Scholarship 2026", rows[1][0])

    def test_failed_fetch_keeps_portal_audit_row_inactive(self):
        def failing_fetcher(_url):
            raise OSError("network blocked")

        with tempfile.TemporaryDirectory() as tmp:
            db_path = os.path.join(tmp, "scholarships.db")
            result = refresh_sources(db_path, [SAMPLE_SOURCE], failing_fetcher, dry_run=False)

            db = sqlite3.connect(db_path)
            try:
                row = db.execute(
                    "SELECT opportunity_type, is_active, is_verified, description FROM scholarships LIMIT 1"
                ).fetchone()
            finally:
                db.close()

        self.assertEqual(result["records_ready"], 1)
        self.assertEqual(row[0], "official_portal")
        self.assertEqual(row[1], 0)
        self.assertEqual(row[2], 0)
        self.assertIn("Fetch error", row[3])


if __name__ == "__main__":
    unittest.main()
