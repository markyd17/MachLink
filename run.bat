@echo off
title MachLink
cd /d "%~dp0"
if not exist config.yaml (
    echo config.yaml not found - copy config.example.yaml to config.yaml and fill it in first.
    pause
    exit /b 1
)
python app.py
pause
