@echo off
cd /d %~dp0
if not exist .env (
  copy .env.example .env >nul
  echo.
  echo =====================================================
  echo ERSTER START: Bitte jetzt den Asana PAT eintragen.
  echo Datei: %CD%\.env
  echo Feld:  ASANA_ACCESS_TOKEN=...
  echo =====================================================
  echo.
  notepad .env
  echo Danach start.bat erneut ausfuehren.
  pause
  exit /b 0
)
if not exist .venv (
  py -m venv .venv
)
call .venv\Scripts\activate
python -m pip install -q -r requirements.txt
start "" http://127.0.0.1:8765
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
