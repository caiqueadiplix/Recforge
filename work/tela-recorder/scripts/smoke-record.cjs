const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const ffmpeg = require("@ffmpeg-installer/ffmpeg");

const outDir = path.join(process.cwd(), "test-output");
fs.mkdirSync(outDir, { recursive: true });

const outputPath = path.join(outDir, "smoke-start-stop.mp4");
try {
  fs.unlinkSync(outputPath);
} catch {
  // The file does not exist yet.
}

const args = [
  "-y",
  "-hide_banner",
  "-f",
  "gdigrab",
  "-framerate",
  "15",
  "-i",
  "desktop",
  "-map",
  "0:v",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-crf",
  "30",
  "-pix_fmt",
  "yuv420p",
  outputPath,
];

const recorder = spawn(ffmpeg.path, args, {
  stdio: ["pipe", "ignore", "pipe"],
  windowsHide: true,
});

let stderr = "";
recorder.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

setTimeout(() => {
  recorder.stdin.write("q\n");
}, 3500);

recorder.on("exit", (code) => {
  const exists = fs.existsSync(outputPath);
  const size = exists ? fs.statSync(outputPath).size : 0;
  const passed = (code === 0 || code === 255) && size > 50_000;

  console.log(
    JSON.stringify(
      {
        passed,
        code,
        outputPath,
        exists,
        size,
        tail: stderr.split("\n").slice(-12).join("\n"),
      },
      null,
      2,
    ),
  );

  process.exit(passed ? 0 : 1);
});
