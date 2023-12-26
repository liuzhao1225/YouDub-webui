@echo off
SETLOCAL

:: Activate the virtual environment
CALL venv\Scripts\activate

:: Start the application
echo Starting the application...
python app.py
pause

ENDLOCAL
