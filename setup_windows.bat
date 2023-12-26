@echo off
SETLOCAL

:: Check for Python 3.10
py -3.10 -c "print('Python 3.10 is installed.')" >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Python 3.10 is not installed.
    echo Please download and install Python 3.10 from https://www.python.org/downloads/
    pause
    EXIT /B
)

:: Create a virtual environment if it doesn't exist
IF NOT EXIST "venv" (
    echo Creating virtual environment...
    py -3.10 -m venv venv
)

:: Activate the virtual environment
CALL venv\Scripts\activate

:: Upgrade pip and install requirements
echo Upgrading pip and installing requirements...
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install TTS
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

echo Setup complete.
pause
ENDLOCAL
