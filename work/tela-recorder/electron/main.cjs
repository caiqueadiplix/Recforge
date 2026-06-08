const { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, session } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

let mainWindow = null;
let overlayWindow = null;
let recordingProcess = null;
let recordingStderr = "";
let controlServer = null;
const shouldQuickStart = process.argv.includes("--quick-start");
const defaultShortcuts = {
  startStop: "Ctrl+Alt+R",
  pause: "Ctrl+Alt+P",
  mute: "Ctrl+Alt+M",
  show: "Ctrl+Alt+S",
};

function ffmpegPath() {
  return process.env.FFMPEG_PATH || ffmpegInstaller.path || "ffmpeg";
}

function defaultOutputDir() {
  return path.join(app.getPath("videos"), "Tela Recorder");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 680,
    title: "Tela Recorder",
    backgroundColor: "#10151d",
    show: !shouldQuickStart,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    if (shouldQuickStart) {
      mainWindow.webContents.send("recorder-command", "start");
    }
  });
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    width: 250,
    height: 62,
    x: 20,
    y: 220,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setContentProtection(true);
  overlayWindow.loadFile(path.join(__dirname, "overlay.html"));
  return overlayWindow;
}

app.whenReady().then(() => {
  createWindow();
  createOverlayWindow();
  startControlServer();
  registerShortcuts(defaultShortcuts);
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["media", "display-capture"].includes(permission));
  });
});

app.on("window-all-closed", () => {
  if (recordingProcess) {
    recordingProcess.kill();
    recordingProcess = null;
  }

  if (process.platform !== "darwin") {
    globalShortcut.unregisterAll();
    if (controlServer) {
      controlServer.close();
    }
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle("recorder:invoke", async (_event, command, payload) => {
  switch (command) {
    case "get_app_status":
      return getAppStatus();
    case "list_audio_devices":
      return listAudioDevices();
    case "list_capture_sources":
      return listCaptureSources();
    case "open_video_file":
      return openVideoFile();
    case "list_recordings":
      return listRecordings();
    case "delete_recording":
      return deleteRecording(payload);
    case "rename_recording":
      return renameRecording(payload);
    case "convert_to_mp4":
      return convertToMp4(payload);
    case "export_trim":
      return exportTrim(payload);
    case "register_shortcuts":
      return registerShortcuts(payload);
    case "save_media_recording":
      return saveMediaRecording(payload);
    case "overlay_show":
      return showOverlay();
    case "overlay_hide":
      return hideOverlay();
    case "overlay_command":
      return sendRecorderCommand(payload?.command);
    case "start_recording":
      return startRecording(payload?.options || payload);
    case "stop_recording":
      return stopRecording();
    default:
      throw new Error(`Comando desconhecido: ${command}`);
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

function startControlServer() {
  if (controlServer) {
    return;
  }

  controlServer = http.createServer((request, response) => {
    const command = request.url.replace("/", "").trim();
    const allowed = new Set(["start", "stop", "pause", "mute", "show"]);
    if (!allowed.has(command)) {
      response.writeHead(404);
      response.end("unknown command");
      return;
    }

    if (command === "show") {
      mainWindow?.show();
    } else {
      sendRecorderCommand(command);
    }

    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(`ok:${command}`);
  });

  controlServer.listen(17654, "127.0.0.1");
}

async function getAppStatus() {
  return {
    ffmpegAvailable: await hasFfmpeg(),
    outputDir: defaultOutputDir(),
    activeRecording: Boolean(recordingProcess),
  };
}

function hasFfmpeg() {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ["-version"], { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

async function listAudioDevices() {
  if (!(await hasFfmpeg())) {
    throw new Error("FFmpeg nao encontrado. Configure FFMPEG_PATH ou instale o FFmpeg no PATH.");
  }

  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath(),
      ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
      { windowsHide: true },
      (_error, _stdout, stderr) => {
        const devices = parseDshowDevices(stderr);
        resolve({
          microphones: devices,
          systemDevices: devices.filter((name) => {
            const lower = name.toLowerCase();
            return lower.includes("stereo") || lower.includes("mix") || lower.includes("loopback");
          }),
          raw: stderr,
        });
      },
    ).on("error", reject);
  });
}

async function listCaptureSources() {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    fetchWindowIcons: true,
    thumbnailSize: { width: 320, height: 180 },
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.id.startsWith("screen:") ? "screen" : "window",
    thumbnail: source.thumbnail.toDataURL(),
  }));
}

async function openVideoFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Escolha um video para editar",
    properties: ["openFile"],
    filters: [
      { name: "Videos", extensions: ["webm", "mp4", "mov", "mkv"] },
      { name: "Todos os arquivos", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    extension: path.extname(filePath).replace(".", "").toLowerCase(),
  };
}

function videoFromPath(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    extension: path.extname(filePath).replace(".", "").toLowerCase(),
  };
}

function listRecordings() {
  const outputDir = defaultOutputDir();
  fs.mkdirSync(outputDir, { recursive: true });
  const allowed = new Set([".webm", ".mp4", ".mov", ".mkv"]);
  return fs
    .readdirSync(outputDir)
    .map((name) => path.join(outputDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile() && allowed.has(path.extname(filePath).toLowerCase()))
    .map(videoFromPath)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

function deleteRecording(payload) {
  const filePath = payload?.path;
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("Arquivo nao encontrado para excluir.");
  }
  fs.unlinkSync(filePath);
  return true;
}

function renameRecording(payload) {
  const filePath = payload?.path;
  const nextName = String(payload?.name || "").trim();
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("Arquivo nao encontrado para renomear.");
  }
  if (!nextName) {
    throw new Error("Nome invalido.");
  }

  const parsed = path.parse(filePath);
  const safeName = nextName.replace(/[<>:"/\\|?*]/g, "-");
  const outputPath = path.join(parsed.dir, `${safeName}${parsed.ext}`);
  fs.renameSync(filePath, outputPath);
  return videoFromPath(outputPath);
}

function convertToMp4(payload) {
  const inputPath = payload?.path;
  const quality = payload?.quality || "balanced";
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error("Arquivo nao encontrado para converter.");
  }

  const parsed = path.parse(inputPath);
  const outputPath = path.join(parsed.dir, `${parsed.name}.mp4`);
  if (inputPath.toLowerCase() === outputPath.toLowerCase()) {
    return videoFromPath(inputPath);
  }

  const args = [
    "-y",
    "-hide_banner",
    "-i",
    inputPath,
    ...mp4EncodingArgs(quality),
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), args, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`Falha ao converter para MP4: ${stderr || error.message}`));
        return;
      }
      resolve(videoFromPath(outputPath));
    });
  });
}

function mp4EncodingArgs(quality) {
  const profile = {
    high: { crf: "16", preset: "slow", audio: "320k" },
    small: { crf: "23", preset: "medium", audio: "192k" },
    balanced: { crf: "18", preset: "medium", audio: "320k" },
  }[quality] || { crf: "18", preset: "medium", audio: "320k" };

  return [
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    profile.crf,
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-c:a",
    "aac",
    "-b:a",
    profile.audio,
    "-movflags",
    "+faststart",
  ];
}

function exportTrim(payload) {
  const inputPath = payload?.inputPath;
  const start = Math.max(0, Number(payload?.start || 0));
  const end = Math.max(start + 0.1, Number(payload?.end || 0));

  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error("Video de entrada nao encontrado.");
  }

  const outputDir = defaultOutputDir();
  fs.mkdirSync(outputDir, { recursive: true });
  const parsed = path.parse(inputPath);
  const outputPath = path.join(outputDir, `${parsed.name}-editado-${Date.now()}${parsed.ext || ".webm"}`);
  const args = [
    "-y",
    "-hide_banner",
    "-ss",
    String(start),
    "-to",
    String(end),
    "-i",
    inputPath,
    "-c",
    "copy",
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), args, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`Falha ao exportar corte: ${stderr || error.message}`));
        return;
      }

      const stat = fs.statSync(outputPath);
      resolve({
        outputPath,
        size: stat.size,
      });
    });
  });
}

function saveMediaRecording(payload) {
  const outputDir = payload?.outputDir || defaultOutputDir();
  const extension = payload?.extension || "webm";
  const data = payload?.data;

  if (!data) {
    throw new Error("Nenhum dado de gravacao recebido para salvar.");
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `gravacao-${Date.now()}.${extension}`);
  const buffer = Buffer.from(new Uint8Array(data));
  fs.writeFileSync(outputPath, buffer);

  return {
    outputPath,
    size: buffer.length,
  };
}

function showOverlay() {
  const overlay = createOverlayWindow();
  overlay.showInactive();
}

function hideOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

function sendRecorderCommand(command) {
  if (!command) {
    return;
  }

  if (mainWindow?.isDestroyed() === false) {
    mainWindow.webContents.send("recorder-command", command);
  }
}

function registerShortcuts(shortcuts = defaultShortcuts) {
  globalShortcut.unregisterAll();

  const bindings = [
    [shortcuts.startStop, () => sendRecorderCommand("toggle-recording")],
    [shortcuts.pause, () => sendRecorderCommand("pause")],
    [shortcuts.mute, () => sendRecorderCommand("mute")],
    [shortcuts.show, () => mainWindow?.show()],
  ];

  const results = {};
  for (const [accelerator, handler] of bindings) {
    if (!accelerator) {
      continue;
    }

    results[accelerator] = globalShortcut.register(accelerator, handler);
  }

  return results;
}

function startRecording(options) {
  if (recordingProcess) {
    throw new Error("Ja existe uma gravacao em andamento.");
  }

  const normalized = {
    fps: Number(options?.fps || 60),
    quality: String(options?.quality || "balanced"),
    captureSystemAudio: Boolean(options?.captureSystemAudio),
    captureMicrophone: Boolean(options?.captureMicrophone),
    microphoneDevice: cleanDevice(options?.microphoneDevice),
    systemAudioDevice: cleanDevice(options?.systemAudioDevice),
    outputDir: options?.outputDir || defaultOutputDir(),
  };

  fs.mkdirSync(normalized.outputDir, { recursive: true });
  const outputPath = path.join(normalized.outputDir, `gravacao-${Date.now()}.mp4`);
  const args = [
    "-y",
    "-hide_banner",
    "-f",
    "gdigrab",
    "-framerate",
    String(Math.max(15, Math.min(normalized.fps, 60))),
    "-i",
    "desktop",
  ];

  let audioInputCount = 0;

  if (normalized.captureMicrophone && normalized.microphoneDevice) {
    args.push("-f", "dshow", "-i", `audio=${normalized.microphoneDevice}`);
    audioInputCount += 1;
  }

  if (normalized.captureSystemAudio && normalized.systemAudioDevice) {
    args.push("-f", "dshow", "-i", `audio=${normalized.systemAudioDevice}`);
    audioInputCount += 1;
  }

  args.push(...mappingArgs(audioInputCount), ...encodingArgs(normalized.quality), outputPath);

  recordingProcess = spawn(ffmpegPath(), args, {
    windowsHide: true,
    stdio: ["pipe", "ignore", "pipe"],
  });
  recordingStderr = "";

  recordingProcess.stderr.on("data", (chunk) => {
    recordingStderr = `${recordingStderr}${chunk.toString()}`.slice(-4000);
  });

  recordingProcess.once("exit", () => {
    recordingProcess = null;
  });

  recordingProcess.once("error", (error) => {
    recordingProcess = null;
    if (mainWindow) {
      mainWindow.webContents.send("recorder:error", error.message);
    }
  });

  return { outputPath };
}

function stopRecording() {
  if (!recordingProcess) {
    return;
  }

  const processToStop = recordingProcess;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      processToStop.kill();
      recordingProcess = null;
      reject(new Error("O FFmpeg demorou demais para finalizar a gravacao."));
    }, 10000);

    processToStop.once("exit", (code) => {
      clearTimeout(timeout);
      recordingProcess = null;
      if (code === 0 || code === 255 || code === null) {
        resolve();
        return;
      }

      reject(new Error(`FFmpeg finalizou com codigo ${code}: ${recordingStderr}`));
    });

    processToStop.stdin.write("q\n");
  });
}

function parseDshowDevices(raw) {
  const devices = [];
  let insideAudioSection = false;
  for (const line of raw.split(/\r?\n/)) {
    if (line.includes("DirectShow audio devices")) {
      insideAudioSection = true;
      continue;
    }

    if (!insideAudioSection) {
      continue;
    }

    const match = line.match(/"([^"]+)"/);
    if (match && !match[1].includes("@") && !devices.includes(match[1])) {
      devices.push(match[1]);
    }
  }
  return devices;
}

function cleanDevice(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function mappingArgs(audioInputCount) {
  if (audioInputCount === 0) {
    return ["-map", "0:v"];
  }
  if (audioInputCount === 1) {
    return ["-map", "0:v", "-map", "1:a"];
  }
  return ["-filter_complex", "[1:a][2:a]amix=inputs=2:duration=longest[aout]", "-map", "0:v", "-map", "[aout]"];
}

function encodingArgs(quality) {
  const profile = {
    high: { crf: "16", preset: "slow" },
    small: { crf: "26", preset: "veryfast" },
    balanced: { crf: "20", preset: "medium" },
  }[quality] || { crf: "20", preset: "medium" };

  return ["-c:v", "libx264", "-preset", profile.preset, "-crf", profile.crf, "-pix_fmt", "yuv420p"];
}
