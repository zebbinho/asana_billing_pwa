import pytest
from fastapi import HTTPException
from app import main

FIELD = {"gid": "budget", "commissioned_field": {"gid": "hours"}}
def task(gid, value, name="Service"):
    return {"gid": gid, "custom_fields": [{"gid":"hours", "number_value":value}, {"gid":"budget", "display_value":name}]}

def test_commissioned_once_per_task_zero_and_null():
    tasks = [task("a", 12), task("b", 4), task("a",12), task("c",0,"Zero"),task("d",None)]
    actual = main.commissioned_budgets(tasks,FIELD)
    assert {b["budget_name"]:b["commissioned_hours"] for b in actual} == {"Service":16,"Zero":0}
    merged=main.effective_budgets([{"budget_name":"Service","commissioned_hours":99},{"budget_name":"Fallback","commissioned_hours":5}],dict(FIELD,commissioned_budgets=actual))
    assert {b["budget_name"]:b["commissioned_hours"] for b in merged} == {"Service":16,"Zero":0,"Fallback":5}

@pytest.mark.parametrize("value,name", [(-1,"Service"),(float("nan"),"Service"),(3,None)])
def test_invalid_commissioned(value,name):
    with pytest.raises(HTTPException): main.commissioned_budgets([task("a",value,name)],FIELD)

def test_preview_uses_budget_tasks_without_bookings_and_cumulative(monkeypatch,tmp_path):
    monkeypatch.setattr(main,"DB_PATH",tmp_path/"db")
    field=dict(FIELD,commissioned_budgets=main.commissioned_budgets([task("budget-only",10)],FIELD))
    entries=[{"gid":str(i),"duration_minutes":60,"entered_on":day,"task":{"gid":"t","name":"Work"},"attributable_to":{"gid":"p","name":"Project"}} for i,day in enumerate(["2026-08-01","2026-09-01"])]
    monkeypatch.setattr(main,"get_entries",lambda start,end,p: entries if start is None else [])
    monkeypatch.setattr(main,"enrich_task_budgets",lambda p,rows:([dict(r,asana_budget="Service") for r in rows],field))
    result=main.preview("p",start="2026-09-01",end="2026-09-30")
    assert result["entries"]==1
    assert result["budgets"][0]["commissioned_hours"]==10
    assert result["budgets"][0]["delivered_hours"]==2
    assert result["budgets"][0]["remaining_hours"]==8
    monkeypatch.setattr(main,"OUTPUT",tmp_path/"reports")
    main.generate(main.GenerateIn(project_gid="p",month="2026-09"))
    import csv
    with next((tmp_path/"reports").rglob("04_budget_summary.csv")).open(encoding="utf-8-sig") as f:
        budget=next(csv.DictReader(f,delimiter=";"))
    assert float(budget["commissioned_hours"])==10
    assert float(budget["delivered_hours"])==2
    assert float(budget["remaining_hours"])==8
