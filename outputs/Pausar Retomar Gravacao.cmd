@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'http://127.0.0.1:17654/pause' -UseBasicParsing | Out-Null"
