@echo off
cd /d "C:\Users\supor\Documents\Codex\2026-06-05\chefe-o-que-sria-i5-repository\work\tela-recorder"
call npm run build
call node_modules\.bin\electron.cmd .
