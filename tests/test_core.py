from app.main import month_bounds, de_hours, normalize

def test_month_bounds():
    assert month_bounds('2024-02') == ('2024-02-01','2024-02-29')

def test_hours_format():
    assert de_hours(8) == '8'
    assert de_hours(1.5) == '1,5'
    assert de_hours(0.5) == '0,5'

def test_normalize_nulls():
    r=normalize({'gid':'1','duration_minutes':30,'entered_on':'2026-09-01','created_by':{'name':'A'},'task':None,'attributable_to':None})
    assert r['task_name']=='OHNE TASK-ZUORDNUNG'
    assert r['project_name']=='OHNE PROJEKT-ZUORDNUNG'
    assert r['hours']==0.5

from fastapi import HTTPException
from app.main import validate_range, period_key

def test_validate_range():
    assert validate_range('2026-08-15','2026-10-03') == ('2026-08-15','2026-10-03')

def test_validate_range_rejects_reverse():
    try:
        validate_range('2026-10-03','2026-08-15')
        assert False
    except HTTPException as exc:
        assert exc.status_code == 400

def test_period_key_month_and_range():
    assert period_key('2026-09-01','2026-09-30') == '2026-09'
    assert period_key('2026-09-15','2026-10-03') == '2026-09-15_bis_2026-10-03'

from app.main import custom_field_value, extract_budget_from_task

def test_custom_field_value_enum():
    field = {"display_value": "Customizing", "enum_value": {"name": "Customizing"}}
    assert custom_field_value(field) == "Customizing"

def test_extract_budget_prefers_gid():
    task = {"custom_fields": [
        {"gid": "other", "name": "apenio-Budgets", "display_value": "Falsch"},
        {"gid": "budget123", "name": "Umbenannt", "display_value": "Projektmanagement"},
    ]}
    assert extract_budget_from_task(task, {"gid": "budget123", "name": "apenio-Budgets"}) == "Projektmanagement"

def test_extract_budget_missing_value():
    task = {"custom_fields": [{"gid": "budget123", "name": "apenio-Budgets", "display_value": None, "enum_value": None}]}
    assert extract_budget_from_task(task, {"gid": "budget123"}) is None
