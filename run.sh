#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -f config.yaml ]; then
    echo "config.yaml not found - copy config.example.yaml to config.yaml and fill it in first."
    exit 1
fi
python3 app.py
