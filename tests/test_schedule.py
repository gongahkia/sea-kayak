import datetime
from pathlib import Path
import unittest
from zoneinfo import ZoneInfo

import yaml


class SingaporeSchedule(unittest.TestCase):
    def test_daily_schedule_falls_at_singapore_midnight(self):
        workflow = Path(__file__).resolve().parents[1] / ".github/workflows/collate.yml"
        data = yaml.load(workflow.read_text(), Loader=yaml.BaseLoader)
        for schedule in data["on"]["schedule"]:
            minute, hour, day, month, weekday = schedule["cron"].split()
            self.assertEqual((day, month, weekday), ("*", "*", "*"))
            for date in [(2026, 1, 1), (2026, 7, 1)]:
                scheduled = datetime.datetime(
                    *date,
                    int(hour),
                    int(minute),
                    tzinfo=ZoneInfo(schedule.get("timezone", "UTC"))
                )
                singapore = scheduled.astimezone(ZoneInfo("Asia/Singapore"))
                self.assertEqual((singapore.hour, singapore.minute), (0, 0))


if __name__ == "__main__":
    unittest.main()
