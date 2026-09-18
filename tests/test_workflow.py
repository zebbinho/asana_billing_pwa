import pytest
from fastapi import HTTPException
from app import main


def test_atomic_save_and_validation(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DB_PATH', tmp_path / 'test.db')
    payload = main.ProjectSaveIn(customer_name='Kunde', budgets=[main.BudgetIn(budget_name='Service',commissioned_hours=12)], mappings=[main.MappingIn(task_gid='t1',budget_name='Service',work_package='Paket')])
    main.save_all('p1',payload)
    saved=main.get_settings('p1')
    assert saved['budgets'][0]['commissioned_hours']==12
    assert saved['mappings']['t1']['work_package']=='Paket'
    invalid=payload.model_copy(update={'budgets':[main.BudgetIn(budget_name='Service'),main.BudgetIn(budget_name='Service')]})
    with pytest.raises(HTTPException): main.save_all('p1',invalid)
    assert main.get_settings('p1')['budgets'][0]['commissioned_hours']==12


def test_inline_pdf_and_path_boundary(tmp_path,monkeypatch):
    monkeypatch.setattr(main,'OUTPUT',tmp_path/'reports')
    folder=main.OUTPUT/'2026-09'/'p1'
    folder.mkdir(parents=True)
    (folder/'customer_service_report.pdf').write_bytes(b'%PDF-1.4')
    result=main.download('2026-09','p1','customer_service_report.pdf',inline=True)
    assert result.headers['content-disposition'].startswith('inline')
    assert result.headers['cache-control']=='no-store'
    assert main.download('2026-09','p1','customer_service_report.pdf').headers['content-disposition'].startswith('attachment')
    outside=tmp_path/'reports-other'
    outside.mkdir()
    (outside/'secret.txt').write_text('private')
    with pytest.raises(HTTPException): main.download('..','reports-other','secret.txt')


def test_preview_warning_totals_and_pdf_link(tmp_path,monkeypatch):
    monkeypatch.setattr(main,'OUTPUT',tmp_path/'reports')
    monkeypatch.setattr(main,'DB_PATH',tmp_path/'test.db')
    entry={'gid':'e1','duration_minutes':60,'entered_on':'2026-09-01','task':None,'attributable_to':None}
    monkeypatch.setattr(main,'get_entries',lambda *args:[entry])
    monkeypatch.setattr(main,'enrich_task_budgets',lambda p,rows:(rows,None))
    result=main.generate(main.GenerateIn(project_gid='p1',month='2026-09'))
    assert result['unassigned_cumulative']==1
    assert result['missing_task']==1
    assert result['missing_project']==1
    assert result['pdf'].endswith('/customer_service_report.pdf')

    assert result['preview_pages']
    assert main.preview_page(result['preview_pages'][0].split('/')[3],'p1',0).body.startswith(b'\x89PNG')
    with pytest.raises(HTTPException): main.preview_page(result['preview_pages'][0].split('/')[3],'p1',99)
