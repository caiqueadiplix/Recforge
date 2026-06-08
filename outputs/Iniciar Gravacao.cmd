@echo off
set APP_DIR=C:\Users\supor\Documents\Codex\2026-06-05\chefe-o-que-sria-i5-repository\work\tela-recorder
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:17654/start' -UseBasicParsing | Out-Null } catch { Start-Process -WindowStyle Minimized -FilePath 'cmd.exe' -ArgumentList '/c', 'cd /d ""%APP_DIR%"" && node_modules\.bin\electron.cmd . --quick-start' }"
