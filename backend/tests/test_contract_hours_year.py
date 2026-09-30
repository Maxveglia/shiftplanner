"""A convenio fixes a YEAR of hours, so a whole year owes exactly that -- leap or not.

Pure arithmetic, no database. Dividing every stretch by 365 made 2028 owe
1,787.9 hours on a 1,783-hour agreement.
"""

from datetime import date

import pytest

from app.services.workday import WorkdayLimits, agreed_year_hours_between

SPAIN = WorkdayLimits(weekly_average_hours=40, annual_hours=1783)


@pytest.mark.parametrize("year", [2026, 2027, 2028])
def test_a_whole_year_is_the_agreed_year(year):
    got = agreed_year_hours_between(SPAIN, 40, date(year, 1, 1), date(year + 1, 1, 1))
    assert got == pytest.approx(1783)


def test_a_part_time_year_is_its_share():
    got = agreed_year_hours_between(SPAIN, 20, date(2028, 1, 1), date(2029, 1, 1))
    assert got == pytest.approx(891.5)


def test_october_is_thirty_one_days_of_its_year():
    got = agreed_year_hours_between(SPAIN, 40, date(2026, 10, 1), date(2026, 11, 1))
    assert got == pytest.approx(1783 * 31 / 365)


def test_a_stretch_across_new_year_takes_each_side_from_its_own_year():
    # December 2027 (31 of 365) plus January 2028 (31 of 366).
    got = agreed_year_hours_between(SPAIN, 40, date(2027, 12, 1), date(2028, 2, 1))
    assert got == pytest.approx(1783 * (31 / 365 + 31 / 366))


def test_without_an_agreed_year_the_week_is_multiplied_out_as_before():
    bare = WorkdayLimits()
    got = agreed_year_hours_between(bare, 40, date(2026, 10, 1), date(2026, 11, 1))
    assert got == pytest.approx(40 * 31 / 7)
