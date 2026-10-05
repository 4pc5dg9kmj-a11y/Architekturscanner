@echo off
REM Notenscanner installieren (Windows)
cd /d "%~dp0"
py -3 -m venv .venv || python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install --no-deps "basic-pitch==0.4.0"
echo.
echo Fertig. Starten mit start.bat
pause
