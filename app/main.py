from __future__ import annotations

import csv
import io
import json
import os
import sqlite3
import zipfile
from uuid import uuid4
from calendar import monthrange
from datetime import date, datetime
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
import pymupdf
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .access import trial_access, hosted
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
DATA_DIR = Path(os.getenv("DATA_DIR", str(ROOT))).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / ".billing.db"
OUTPUT = DATA_DIR / "output"
STATIC = Path(__file__).resolve().parent / "static"
BASE = "https://app.asana.com/api/1.0"

app = FastAPI(title="Asana Billing PWA", version="0.5.0")
app.middleware("http")(trial_access)


def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS project_settings(
            project_gid TEXT PRIMARY KEY,
            customer_name TEXT,
            project_name TEXT
        );
        CREATE TABLE IF NOT EXISTS budgets(
            project_gid TEXT NOT NULL,
            budget_name TEXT NOT NULL,
            commissioned_hours REAL NOT NULL DEFAULT 0,
            PRIMARY KEY(project_gid,budget_name)
        );
        CREATE TABLE IF NOT EXISTS task_mappings(
            project_gid TEXT NOT NULL,
            task_gid TEXT NOT NULL,
            task_name TEXT,
            budget_name TEXT,
            work_package TEXT,
            PRIMARY KEY(project_gid,task_gid)
        );
        """
    )
    return con


def token() -> str:
    value = os.getenv("ASANA_ACCESS_TOKEN", "").strip()
    if not value or "HIER_DEIN" in value:
        raise HTTPException(503, "ASANA_ACCESS_TOKEN ist nicht gesetzt. Bitte .env bearbeiten.")
    return value


def workspace_gid() -> str:
    return os.getenv("ASANA_WORKSPACE_GID", "1207205268697266").strip()


def headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {token()}", "Accept": "application/json"}


def asana_get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    r = requests.get(BASE + path, headers=headers(), params=params, timeout=30)
    if r.status_code >= 400:
        msg = "Asana API Fehler"
        try:
            msg = r.json().get("errors", [{}])[0].get("message", msg)
        except Exception:
            pass
        raise HTTPException(r.status_code, msg)
    return r.json()


def paged(path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    p = dict(params)
    p["limit"] = 100
    while True:
        body = asana_get(path, p)
        out.extend(body.get("data", []))
        nxt = body.get("next_page") or {}
        off = nxt.get("offset")
        if not off:
            break
        p["offset"] = off
    return out


def month_bounds(month: str) -> tuple[str, str]:
    try:
        y, m = map(int, month.split("-"))
        last = monthrange(y, m)[1]
        return f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{last:02d}"
    except Exception as e:
        raise HTTPException(400, "Monat muss YYYY-MM sein") from e


def validate_range(start: str, end: str) -> tuple[str, str]:
    """Validate an inclusive ISO date range and return normalized strings."""
    try:
        start_d = date.fromisoformat(start)
        end_d = date.fromisoformat(end)
    except Exception as e:
        raise HTTPException(400, "Von/Bis muss im Format YYYY-MM-DD angegeben werden") from e
    if start_d > end_d:
        raise HTTPException(400, "Das Von-Datum darf nicht nach dem Bis-Datum liegen")
    return start_d.isoformat(), end_d.isoformat()


def period_key(start: str, end: str) -> str:
    """Filesystem-safe key for arbitrary report periods."""
    start, end = validate_range(start, end)
    if start[:7] == end[:7] and start.endswith("-01"):
        y, m = map(int, start[:7].split("-"))
        if end == f"{y:04d}-{m:02d}-{monthrange(y, m)[1]:02d}":
            return start[:7]
    return f"{start}_bis_{end}"


TIME_FIELDS = ",".join([
    "gid", "duration_minutes", "entered_on", "description", "billable_status",
    "created_by.gid", "created_by.name", "attributable_to.gid", "attributable_to.name",
    "task.gid", "task.name"
])


def get_entries(start: str | None, end: str, project_gid: str | None = None) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"workspace": workspace_gid(), "entered_on_end_date": end, "opt_fields": TIME_FIELDS}
    if start:
        params["entered_on_start_date"] = start
    if project_gid:
        params["attributable_to"] = project_gid
        params.pop("workspace", None)
    return paged("/time_tracking_entries", params)


def get_workspace_projects() -> list[dict[str, Any]]:
    """Return all projects visible to the PAT user in the configured workspace.

    This list is intentionally independent of time entries so projects with zero
    bookings in the selected month still appear in the UI.
    """
    rows = paged(
        f"/workspaces/{workspace_gid()}/projects",
        {"opt_fields": "gid,name,archived"},
    )
    # Defensive de-duplication in case Asana ever returns overlapping pages.
    unique: dict[str, dict[str, Any]] = {}
    for row in rows:
        gid = row.get("gid")
        if gid:
            unique[gid] = row
    return list(unique.values())



BUDGET_FIELD_NAME = "apenio-Budgets"
TASK_CUSTOM_FIELDS = ",".join([
    "gid", "name",
    "custom_fields.gid", "custom_fields.name", "custom_fields.resource_subtype",
    "custom_fields.display_value",
    "custom_fields.enum_value.gid", "custom_fields.enum_value.name",
    "custom_fields.multi_enum_values.gid", "custom_fields.multi_enum_values.name",
    "custom_fields.text_value", "custom_fields.number_value"
])


def get_project_custom_field_settings(project_gid: str) -> list[dict[str, Any]]:
    return paged(
        f"/projects/{project_gid}/custom_field_settings",
        {"opt_fields": "custom_field.gid,custom_field.name,custom_field.resource_subtype"},
    )


def find_budget_field(project_gid: str) -> dict[str, Any] | None:
    """Find apenio-Budgets on the project, but use its GID once discovered."""
    fields = [x.get("custom_field") or {} for x in get_project_custom_field_settings(project_gid)]
    commissioned = next((f for f in fields if f.get("name", "").strip().casefold() == "beauftragt (h)"), None)
    for name in ["apenio-budgets", "apenio-ai-budgets"]:
        field = next((f for f in fields if f.get("name", "").strip().casefold() == name), None)
        if field:
            return dict(field, commissioned_field=commissioned)
    if commissioned:
        raise HTTPException(422, 'Beauftragt (h) gefunden, aber kein apenio-Budgetfeld für die Zuordnung.')
    return None


def commissioned_budgets(tasks, field):
    """Sum each Asana task once, including tasks without time entries."""
    target = (field.get("commissioned_field") or {}).get("gid")
    totals = {}
    seen = set()
    for task in tasks:
        if task["gid"] in seen:
            continue
        seen.add(task["gid"])
        value = next((f.get("number_value") for f in task.get("custom_fields", []) if f.get("gid") == target), None)
        if value is None:
            continue
        import math
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0:
            raise HTTPException(422, 'Ungültige Stunden in Beauftragt (h). Bitte in Asana korrigieren.')
        name = extract_budget_from_task(task, field)
        if not name:
            raise HTTPException(422, 'Eine Aufgabe mit Beauftragt (h) hat keine Budgetzuordnung. Bitte in Asana ergänzen.')
        totals[name] = totals.get(name, 0) + value
    return [{"budget_name": name, "commissioned_hours": value, "source": "asana"} for name, value in totals.items()]


def effective_budgets(budgets, field):
    merged = {b["budget_name"]: b for b in budgets}
    for b in (field or {}).get("commissioned_budgets", []):
        merged[b["budget_name"]] = b
    return list(merged.values())


def get_task_details(task_gid: str) -> dict[str, Any]:
    return asana_get(f"/tasks/{task_gid}", {"opt_fields": TASK_CUSTOM_FIELDS}).get("data") or {}


def custom_field_value(field: dict[str, Any]) -> str | None:
    """Return a human-readable value for enum/multi-enum/text/number/reference fields."""
    if not field:
        return None
    if field.get("display_value") not in (None, ""):
        return str(field.get("display_value")).strip() or None
    enum = field.get("enum_value") or {}
    if enum.get("name"):
        return str(enum["name"]).strip() or None
    multi = field.get("multi_enum_values") or []
    names = [str(x.get("name")).strip() for x in multi if x.get("name")]
    if names:
        return ", ".join(names)
    if field.get("text_value") not in (None, ""):
        return str(field["text_value"]).strip() or None
    if field.get("number_value") is not None:
        return str(field["number_value"])
    return None


def extract_budget_from_task(task: dict[str, Any], budget_field: dict[str, Any] | None) -> str | None:
    """Extract the apenio-Budgets value. Match by GID first, name only as discovery fallback."""
    if not budget_field:
        return None
    target_gid = budget_field.get("gid")
    for cf in task.get("custom_fields") or []:
        if target_gid and cf.get("gid") == target_gid:
            return custom_field_value(cf)
    for cf in task.get("custom_fields") or []:
        if (cf.get("name") or "").strip().casefold() == BUDGET_FIELD_NAME.casefold():
            return custom_field_value(cf)
    return None


def enrich_task_budgets(project_gid: str, rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Attach asana_budget to normalized time rows while fetching each unique task only once."""
    budget_field = find_budget_field(project_gid)
    if not budget_field:
        return [dict(r, asana_budget=None) for r in rows], None
    if budget_field.get("commissioned_field"):
        project_tasks = paged(f"/projects/{project_gid}/tasks", {"opt_fields": TASK_CUSTOM_FIELDS})
        budget_field["commissioned_budgets"] = commissioned_budgets(project_tasks, budget_field)
    cache: dict[str, str | None] = {}
    out: list[dict[str, Any]] = []
    for r in rows:
        gid = r.get("task_gid")
        if gid and gid not in cache:
            cache[gid] = extract_budget_from_task(get_task_details(gid), budget_field)
        out.append(dict(r, asana_budget=cache.get(gid) if gid else None))
    return out, budget_field


def normalize(e: dict[str, Any]) -> dict[str, Any]:
    task = e.get("task") or {}
    proj = e.get("attributable_to") or {}
    user = e.get("created_by") or {}
    mins = int(e.get("duration_minutes") or 0)
    bill = e.get("billable_status")
    return {
        "time_entry_gid": e.get("gid"),
        "date": e.get("entered_on"),
        "employee_gid": user.get("gid"),
        "employee_name": user.get("name") or "UNBEKANNT",
        "project_gid": proj.get("gid"),
        "project_name": proj.get("name") or "OHNE PROJEKT-ZUORDNUNG",
        "task_gid": task.get("gid"),
        "task_name": task.get("name") or "OHNE TASK-ZUORDNUNG",
        "description": (e.get("description") or "").strip(),
        "minutes": mins,
        "hours": mins / 60.0,
        "billable_status": bill or "notSpecified",
    }


def get_settings(project_gid: str) -> dict[str, Any]:
    con = db()
    ps = con.execute("SELECT * FROM project_settings WHERE project_gid=?", (project_gid,)).fetchone()
    budgets = [dict(x) for x in con.execute("SELECT * FROM budgets WHERE project_gid=? ORDER BY budget_name", (project_gid,))]
    mappings = {x["task_gid"]: dict(x) for x in con.execute("SELECT * FROM task_mappings WHERE project_gid=?", (project_gid,))}
    con.close()
    return {"project": dict(ps) if ps else None, "budgets": budgets, "mappings": mappings}


class BudgetIn(BaseModel):
    budget_name: str
    commissioned_hours: float = 0


class ProjectConfigIn(BaseModel):
    customer_name: str
    project_name: str | None = None
    budgets: list[BudgetIn] = []


class MappingIn(BaseModel):
    task_gid: str
    task_name: str | None = None
    budget_name: str
    work_package: str | None = None


class ProjectSaveIn(ProjectConfigIn):
    mappings: list[MappingIn] = []


class GenerateIn(BaseModel):
    project_gid: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    customer_name: str | None = None
    month: str | None = None
    start: str | None = None
    end: str | None = None

    def resolve_range(self) -> tuple[str, str]:
        if self.start and self.end:
            return validate_range(self.start, self.end)
        if self.month:
            return month_bounds(self.month)
        raise HTTPException(400, "Bitte Monat oder Von/Bis angeben")


@app.get("/api/status")
def status():
    me = asana_get("/users/me").get("data", {})
    return {"ok": True, "user": me.get("name"), "workspace_gid": workspace_gid(), "workspace_name": os.getenv("ASANA_WORKSPACE_NAME", "apenio GmbH")}


@app.get("/api/month/{month}")
def month_data(month: str):
    start, end = month_bounds(month)
    return range_data(start, end)


@app.get("/api/range")
def range_data(start: str, end: str):
    start, end = validate_range(start, end)
    rows = [normalize(x) for x in get_entries(start, end)]

    monthly: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r["project_gid"]:
            p = monthly.setdefault(r["project_gid"], {"hours": 0.0, "entries": 0})
            p["hours"] += r["hours"]
            p["entries"] += 1

    projects: list[dict[str, Any]] = []
    for project in get_workspace_projects():
        gid = project.get("gid")
        totals = monthly.get(gid, {"hours": 0.0, "entries": 0})
        projects.append({
            "gid": gid,
            "name": project.get("name") or gid,
            "archived": bool(project.get("archived")),
            "hours": round(float(totals["hours"]), 2),
            "entries": int(totals["entries"]),
        })

    projects.sort(key=lambda x: (x["archived"], x["name"].lower()))
    return {
        "start": start,
        "end": end,
        "entries": len(rows),
        "hours": round(sum(r["hours"] for r in rows), 2),
        "project_count": len(projects),
        "projects": projects,
    }


@app.get("/api/project/{project_gid}/preview")
def preview(project_gid: str, month: str | None = None, start: str | None = None, end: str | None = None):
    if start and end:
        start, end = validate_range(start, end)
    elif month:
        start, end = month_bounds(month)
    else:
        raise HTTPException(400, "Bitte Monat oder Von/Bis angeben")
    cumulative = [normalize(x) for x in get_entries(None, end, project_gid)]
    cumulative, budget_field = enrich_task_budgets(project_gid, cumulative)
    rows = [r for r in cumulative if start <= r["date"] <= end]
    settings = get_settings(project_gid)
    settings["budgets"] = effective_budgets(settings["budgets"], budget_field)
    mappings = settings["mappings"]
    tasks: dict[str, dict[str, Any]] = {}
    missing_task = missing_project = 0
    auto_budget_tasks = 0
    for r in rows:
        if not r["task_gid"]:
            missing_task += 1
            continue
        if not r["project_gid"]:
            missing_project += 1
        t = tasks.setdefault(r["task_gid"], {
            "task_gid": r["task_gid"], "task_name": r["task_name"], "hours": 0.0,
            "mapping": mappings.get(r["task_gid"]), "asana_budget": r.get("asana_budget")
        })
        t["hours"] += r["hours"]
        if not t.get("asana_budget") and r.get("asana_budget"):
            t["asana_budget"] = r["asana_budget"]
    auto_budget_tasks = sum(1 for t in tasks.values() if t.get("asana_budget"))
    project_name = rows[0]["project_name"] if rows else ""
    if not project_name and settings.get("project"):
        project_name = settings["project"].get("project_name") or ""
    if not project_name:
        try:
            project_name = (asana_get(f"/projects/{project_gid}", {"opt_fields": "name"}).get("data") or {}).get("name") or ""
        except HTTPException:
            project_name = ""
    configured = {b["budget_name"] for b in settings["budgets"]}
    discovered = sorted({t["asana_budget"] for t in tasks.values() if t.get("asana_budget")})
    budgets = list(settings["budgets"])
    for name in discovered:
        if name not in configured:
            budgets.append({"project_gid": project_gid, "budget_name": name, "commissioned_hours": 0.0, "auto_discovered": True})
    delivered = {}
    for r in cumulative:
        if r["billable_status"] == "nonBillable":
            continue
        name = r.get("asana_budget") or (mappings.get(r["task_gid"]) or {}).get("budget_name") or "UNASSIGNED"
        delivered[name] = delivered.get(name, 0) + r["hours"]
    for b in budgets:
        b["delivered_hours"] = delivered.get(b["budget_name"], 0)
        b["remaining_hours"] = b["commissioned_hours"] - b["delivered_hours"]
    return {
        "project_name": project_name,
        "customer_name": (settings.get("project") or {}).get("customer_name") or "",
        "hours": round(sum(r["hours"] for r in rows), 2),
        "entries": len(rows),
        "missing_task": missing_task,
        "missing_project": missing_project,
        "tasks": sorted(tasks.values(), key=lambda x: x["task_name"].lower()),
        "budgets": sorted(budgets, key=lambda x: x["budget_name"].lower()),
        "budget_field": budget_field,
        "auto_budget_tasks": auto_budget_tasks,
        "unmapped_budget_tasks": sum(1 for t in tasks.values() if not t.get("asana_budget") and not (t.get("mapping") or {}).get("budget_name")),
    }


@app.post("/api/project/{project_gid}/config")
def save_config(project_gid: str, payload: ProjectConfigIn):
    con = db()
    con.execute("INSERT INTO project_settings(project_gid,customer_name,project_name) VALUES(?,?,?) ON CONFLICT(project_gid) DO UPDATE SET customer_name=excluded.customer_name, project_name=excluded.project_name", (project_gid, payload.customer_name, payload.project_name))
    con.execute("DELETE FROM budgets WHERE project_gid=?", (project_gid,))
    for b in payload.budgets:
        con.execute("INSERT INTO budgets(project_gid,budget_name,commissioned_hours) VALUES(?,?,?)", (project_gid, b.budget_name.strip(), b.commissioned_hours))
    con.commit(); con.close()
    return {"ok": True}


@app.post("/api/project/{project_gid}/mapping")
def save_mapping(project_gid: str, payload: MappingIn):
    con = db()
    con.execute("INSERT INTO task_mappings(project_gid,task_gid,task_name,budget_name,work_package) VALUES(?,?,?,?,?) ON CONFLICT(project_gid,task_gid) DO UPDATE SET task_name=excluded.task_name,budget_name=excluded.budget_name,work_package=excluded.work_package", (project_gid, payload.task_gid, payload.task_name, payload.budget_name.strip(), payload.work_package))
    con.commit(); con.close()
    return {"ok": True}


@app.post("/api/project/{project_gid}/save")
def save_all(project_gid: str, payload: ProjectSaveIn):
    import math
    names = [b.budget_name.strip() for b in payload.budgets]
    if any(not n for n in names) or len(names) != len(set(names)):
        raise HTTPException(400, "Budgetnamen müssen ausgefüllt und eindeutig sein.")
    if any(not math.isfinite(b.commissioned_hours) or b.commissioned_hours < 0 for b in payload.budgets):
        raise HTTPException(400, "Beauftragte Stunden müssen eine nicht negative Zahl sein.")
    con = db()
    try:
        with con:
            con.execute("INSERT INTO project_settings VALUES(?,?,?) ON CONFLICT(project_gid) DO UPDATE SET customer_name=excluded.customer_name,project_name=excluded.project_name", (project_gid, payload.customer_name, payload.project_name))
            con.execute("DELETE FROM budgets WHERE project_gid=?", (project_gid,))
            con.executemany("INSERT INTO budgets VALUES(?,?,?)", [(project_gid,b.budget_name.strip(),b.commissioned_hours) for b in payload.budgets])
            for m in payload.mappings:
                con.execute("INSERT INTO task_mappings VALUES(?,?,?,?,?) ON CONFLICT(project_gid,task_gid) DO UPDATE SET task_name=excluded.task_name,budget_name=excluded.budget_name,work_package=excluded.work_package", (project_gid,m.task_gid,m.task_name,m.budget_name.strip(),m.work_package))
    finally:
        con.close()
    return {"ok": True}


def de_hours(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]):
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields, delimiter=";")
        w.writeheader()
        for r in rows: w.writerow({k: r.get(k, "") for k in fields})


def make_pdf(path: Path, customer: str, start: str, end: str, lines: list[dict[str, Any]], budgets: list[dict[str, Any]]):
    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=10)
    small = ParagraphStyle("small", parent=body, fontSize=7.5, leading=9)
    num = ParagraphStyle("num", parent=body, alignment=TA_RIGHT)
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=16*mm, rightMargin=16*mm, topMargin=15*mm, bottomMargin=15*mm)
    story = []
    story.append(Paragraph("Dienstleistungsübersicht im apenio Projekt:", styles["Heading2"]))
    story.append(Paragraph(customer, styles["Heading1"]))
    story.append(Paragraph(f"vom: {datetime.strptime(start,'%Y-%m-%d').strftime('%d.%m.%Y')} bis: {datetime.strptime(end,'%Y-%m-%d').strftime('%d.%m.%Y')}", body))
    story.append(Spacer(1, 5*mm))
    data = [[Paragraph("Arbeitspaket", body), Paragraph("Mitarbeiter", body), Paragraph("am", body), Paragraph("Kommentar", body), Paragraph("Std.", body)]]
    for x in sorted(lines, key=lambda r: (r.get("date", ""), r.get("employee_name", ""), r.get("task_name", r.get("work_package", "")))):
        data.append([
            Paragraph(x["work_package"], small), Paragraph(x["employee_name"], small),
            Paragraph(datetime.strptime(x["date"],'%Y-%m-%d').strftime('%d.%m.%Y'), small),
            Paragraph(x["comment"], small), Paragraph(de_hours(x["hours"]), num)
        ])
    data.append(["", "", "", Paragraph("<b>Summe</b>", body), Paragraph(f"<b>{de_hours(sum(x['hours'] for x in lines))}</b>", num)])
    t = Table(data, colWidths=[45*mm, 31*mm, 23*mm, 67*mm, 12*mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("LINEBELOW", (0,0), (-1,0), 0.5, colors.black),
        ("LINEABOVE", (0,-1), (-1,-1), 0.5, colors.black), ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 2), ("RIGHTPADDING", (0,0), (-1,-1), 2),
        ("TOPPADDING", (0,0), (-1,-1), 3), ("BOTTOMPADDING", (0,0), (-1,-1), 3),
    ]))
    story.append(t)
    story.append(Spacer(1, 12*mm))
    story.append(Paragraph("apenio Projekt:", styles["Heading2"]))
    story.append(Paragraph(customer, styles["Heading1"]))
    story.append(Paragraph(f"Auswertung der Budgets bis zum: {datetime.strptime(end,'%Y-%m-%d').strftime('%d.%m.%Y')}", body))
    story.append(Spacer(1, 4*mm))
    bd = [[Paragraph("Budget", body), Paragraph("beauftragt (h)", body), Paragraph("erbracht (h)", body), Paragraph("offen (h)", body)]]
    for b in budgets:
        bd.append([Paragraph(b["budget_name"], small), de_hours(b["commissioned_hours"]), de_hours(b["delivered_hours"]), de_hours(b["remaining_hours"])])
    bd.append([Paragraph("<b>Summen</b>", body), de_hours(sum(b["commissioned_hours"] for b in budgets)), de_hours(sum(b["delivered_hours"] for b in budgets)), de_hours(sum(b["remaining_hours"] for b in budgets))])
    bt = Table(bd, colWidths=[100*mm, 27*mm, 27*mm, 27*mm], repeatRows=1)
    bt.setStyle(TableStyle([("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("LINEBELOW", (0,0), (-1,0), .5, colors.black), ("LINEABOVE", (0,-1), (-1,-1), .5, colors.black), ("ALIGN", (1,1), (-1,-1), "RIGHT"), ("VALIGN", (0,0), (-1,-1), "MIDDLE"), ("TOPPADDING", (0,0), (-1,-1), 4), ("BOTTOMPADDING", (0,0), (-1,-1), 4)]))
    story.append(bt)
    doc.build(story)


@app.post("/api/report/generate")
def generate(payload: GenerateIn):
    start, end = payload.resolve_range()
    key = period_key(start, end)
    monthly = [normalize(x) for x in get_entries(start, end, payload.project_gid)]
    cumulative = [normalize(x) for x in get_entries(None, end, payload.project_gid)]
    monthly, budget_field = enrich_task_budgets(payload.project_gid, monthly)
    cumulative, _ = enrich_task_budgets(payload.project_gid, cumulative)
    settings = get_settings(payload.project_gid)
    pset = settings.get("project") or {}
    customer = payload.customer_name or pset.get("customer_name") or (monthly[0]["project_name"] if monthly else payload.project_gid)
    mappings = settings["mappings"]
    budget_defs = {b["budget_name"]: float(b["commissioned_hours"]) for b in effective_budgets(settings["budgets"], budget_field)}

    def enrich(rows):
        out=[]
        for r in rows:
            m = mappings.get(r["task_gid"]) if r["task_gid"] else None
            # Asana's apenio-Budgets is authoritative. Local mapping is fallback only.
            budget = r.get("asana_budget") or (m or {}).get("budget_name") or "UNASSIGNED"
            work = (m or {}).get("work_package") or r["task_name"]
            comment = r["description"] or r["task_name"]
            x = dict(r); x.update({"budget_name": budget, "budget_source": "asana" if r.get("asana_budget") else ("local_fallback" if (m or {}).get("budget_name") else "unassigned"), "work_package": work, "comment": comment})
            out.append(x)
        return out

    mlines = enrich(monthly); clines = enrich(cumulative)
    delivered: dict[str,float] = {}
    for r in clines:
        if r["billable_status"] == "nonBillable":
            continue
        delivered[r["budget_name"]] = delivered.get(r["budget_name"],0)+r["hours"]
    budget_names = sorted(set(budget_defs) | set(delivered))
    bsum=[]
    for name in budget_names:
        commissioned=budget_defs.get(name,0.0); d=delivered.get(name,0.0)
        bsum.append({"budget_name":name,"commissioned_hours":commissioned,"delivered_hours":round(d,2),"remaining_hours":round(commissioned-d,2)})

    run_key = f"{key}__{uuid4().hex}"
    folder = OUTPUT / run_key / payload.project_gid
    folder.mkdir(parents=True, exist_ok=True)
    raw_fields=["time_entry_gid","date","employee_gid","employee_name","project_gid","project_name","task_gid","task_name","description","minutes","hours","billable_status"]
    bill_fields=raw_fields+["asana_budget","budget_name","budget_source","work_package","comment"]
    write_csv(folder/"01_time_entries_raw.csv", monthly, raw_fields)
    write_csv(folder/"03_billing_lines.csv", mlines, bill_fields)
    write_csv(folder/"04_budget_summary.csv", bsum, ["budget_name","commissioned_hours","delivered_hours","remaining_hours"])
    make_pdf(folder/"customer_service_report.pdf", customer, start, end, mlines, bsum)
    summary={"customer":customer,"period":key,"start":start,"end":end,"project_gid":payload.project_gid,"entries":len(monthly),"monthly_hours":round(sum(x['hours'] for x in monthly),2),"unassigned_monthly":sum(1 for x in mlines if x['budget_name']=='UNASSIGNED'),"unassigned_cumulative":sum(1 for x in clines if x['budget_name']=='UNASSIGNED'),"budget_field":budget_field,"auto_budget_monthly":sum(1 for x in mlines if x.get("budget_source")=="asana"),"files":["01_time_entries_raw.csv","03_billing_lines.csv","04_budget_summary.csv","customer_service_report.pdf"]}
    (folder/"run_summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    zip_path=folder/"report_package.zip"
    with zipfile.ZipFile(zip_path,"w",zipfile.ZIP_DEFLATED) as z:
        for name in summary["files"]+["run_summary.json"]: z.write(folder/name,arcname=name)
    with pymupdf.open(folder/"customer_service_report.pdf") as document:
        pages = document.page_count
    return {"preview_pages":[f"/api/preview/{run_key}/{payload.project_gid}/{page}" for page in range(pages)], **summary,"download":f"/api/download/{run_key}/{payload.project_gid}/report_package.zip", "pdf":f"/api/download/{run_key}/{payload.project_gid}/customer_service_report.pdf", "missing_task":sum(not r["task_gid"] for r in cumulative), "missing_project":sum(not r["project_gid"] for r in cumulative)}


@app.get("/api/download/{period}/{project_gid}/{filename}")
def download(period: str, project_gid: str, filename: str, inline: bool = False):
    path = (OUTPUT / period / project_gid / filename).resolve()
    if not path.is_relative_to(OUTPUT.resolve()) or not path.is_file(): raise HTTPException(404,"Datei nicht gefunden")
    return FileResponse(path, filename=filename, content_disposition_type="inline" if inline and filename.endswith(".pdf") else "attachment", headers={"Cache-Control":"no-store"})


@app.get("/api/preview/{period}/{project_gid}/{page}")
def preview_page(period: str, project_gid: str, page: int):
    path = (OUTPUT / period / project_gid / "customer_service_report.pdf").resolve()
    if not path.is_relative_to(OUTPUT.resolve()) or not path.is_file():
        raise HTTPException(404, "Vorschau nicht gefunden")
    with pymupdf.open(path) as document:
        if page < 0 or page >= document.page_count:
            raise HTTPException(404, "Seite nicht gefunden")
        pixels = document[page].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
        return Response(pixels.tobytes("png"), media_type="image/png", headers={"Cache-Control": "no-store"})


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
