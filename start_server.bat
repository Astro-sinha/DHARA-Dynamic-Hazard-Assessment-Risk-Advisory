@echo off
echo ============================================================
echo   DHARA — AI/ML Landslide Early Warning System
echo   Flask Backend + ML REST API
echo ============================================================
echo.
echo Installing Python dependencies...
py -m pip install -r requirements.txt
echo.
echo Starting Flask server at http://localhost:5000 ...
echo Open your browser and go to: http://localhost:5000
echo.
py server.py
pause
