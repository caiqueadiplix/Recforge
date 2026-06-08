@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:17654/show' -UseBasicParsing | Out-Null } catch { Start-Process -FilePath 'C:\Users\supor\Documents\Codex\2026-06-05\chefe-o-que-sria-i5-repository\outputs\Abrir Tela Recorder.cmd' }"
