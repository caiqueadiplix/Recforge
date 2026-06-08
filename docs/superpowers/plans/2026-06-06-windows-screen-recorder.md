# Windows Screen Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a good-looking Windows-first screen recorder desktop MVP with Tauri, React, and FFmpeg.

**Architecture:** React owns the recording dashboard, settings, and recent recordings list. Tauri exposes Rust commands that validate FFmpeg availability, list audio devices, spawn FFmpeg recording, stop it cleanly, and return paths/errors to the UI.

**Tech Stack:** Tauri 2, React, TypeScript, Vite, Rust, FFmpeg.

---

### Task 1: Project Shell

**Files:**
- Create: `work/tela-recorder/package.json`
- Create: `work/tela-recorder/index.html`
- Create: `work/tela-recorder/tsconfig.json`
- Create: `work/tela-recorder/vite.config.ts`
- Create: `work/tela-recorder/src-tauri/Cargo.toml`
- Create: `work/tela-recorder/src-tauri/build.rs`
- Create: `work/tela-recorder/src-tauri/tauri.conf.json`
- Create: `work/tela-recorder/src-tauri/capabilities/default.json`

- [ ] Add a minimal Tauri React TypeScript project structure.
- [ ] Install dependencies with `npm install`.
- [ ] Run `npm run build`.

### Task 2: Recording Backend

**Files:**
- Create: `work/tela-recorder/src-tauri/src/main.rs`
- Create: `work/tela-recorder/src-tauri/src/lib.rs`

- [ ] Add FFmpeg detection.
- [ ] Add Windows dshow device listing through FFmpeg stderr parsing.
- [ ] Add start/stop commands guarded by a single recording process mutex.
- [ ] Return clear Portuguese errors when FFmpeg is missing or a recording is already running.

### Task 3: Frontend Dashboard

**Files:**
- Create: `work/tela-recorder/src/main.tsx`
- Create: `work/tela-recorder/src/App.tsx`
- Create: `work/tela-recorder/src/styles.css`

- [ ] Build a polished dashboard with preview, REC controls, audio meters, quality/FPS settings, output path, and recent recordings.
- [ ] Wire Tauri commands with graceful fallback while dependencies are still being installed.
- [ ] Show FFmpeg status prominently.

### Task 4: Verification

- [ ] Run `npm run build`.
- [ ] Run `cargo check` in `work/tela-recorder/src-tauri`.
- [ ] If FFmpeg is not installed, verify the UI shows the missing dependency state instead of crashing.
