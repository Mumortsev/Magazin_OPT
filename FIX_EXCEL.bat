@echo off
echo ==========================================
echo Fix for Excel Import Error
echo ==========================================
echo.
cd backend
echo Installing xlrd, openpyxl and pandas...
python -m pip install xlrd>=2.0.1 openpyxl pandas
echo.
echo ==========================================
echo Done! Please restart your server now.
echo ==========================================
pause
