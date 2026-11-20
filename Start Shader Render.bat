@echo off
title Shader Render
cd /d "%~dp0"
set "PORT=8765"

rem Find Python (python.exe or the py launcher)
set "PY="
python --version >nul 2>nul && set "PY=python"
if not defined PY py --version >nul 2>nul && set "PY=py"
if not defined PY (
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during setup.
  pause
  exit /b 1
)

rem Image -> Shader can use Claude if the Anthropic SDK and an API key are set up
%PY% -c "import anthropic" >nul 2>nul
if errorlevel 1 (
  echo Image to Shader: Claude is off. To turn it on: python -m pip install anthropic
  echo                 and set ANTHROPIC_API_KEY ^(see README.md^).
) else if not defined ANTHROPIC_API_KEY (
  if not defined ANTHROPIC_AUTH_TOKEN echo Image to Shader: Anthropic SDK found, but ANTHROPIC_API_KEY isn't set ^(see README.md^).
)
echo.
echo Shader Render is running at http://127.0.0.1:%PORT%/
echo Close this window to stop the server.
echo.

rem Open the browser once the server has had a moment to start
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:%PORT%/"

rem serve.py listens on 127.0.0.1 only and rejects non-local Host headers
%PY% "%~dp0serve.py" %PORT%
if errorlevel 1 (
  echo.
  echo The server stopped with an error. Port %PORT% may already be in use.
  pause
)
