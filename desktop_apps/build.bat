@echo off
set PYTHON_EXE=python
if exist "..\backend\venv\Scripts\python.exe" (
    set PYTHON_EXE=..\backend\venv\Scripts\python.exe
)
"%PYTHON_EXE%" build.py
pause
