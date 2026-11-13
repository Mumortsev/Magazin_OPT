@echo off
echo Starting Local Server...
echo Static Source: Frontend Directory

cd backend
call venv\Scripts\python.exe -m uvicorn api.main:app --reload --host 0.0.0.0 --port 3000
pause
