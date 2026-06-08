use serde::{Deserialize, Serialize};
use std::{
    env,
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

static RECORDER: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    ffmpeg_available: bool,
    output_dir: String,
    active_recording: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioDevices {
    microphones: Vec<String>,
    system_devices: Vec<String>,
    raw: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordingOptions {
    fps: u16,
    quality: String,
    capture_system_audio: bool,
    capture_microphone: bool,
    microphone_device: Option<String>,
    system_audio_device: Option<String>,
    output_dir: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingStarted {
    output_path: String,
}

#[tauri::command]
fn get_app_status() -> AppStatus {
    AppStatus {
        ffmpeg_available: ffmpeg_available(),
        output_dir: default_output_dir().to_string_lossy().to_string(),
        active_recording: is_recording(),
    }
}

#[tauri::command]
fn list_audio_devices() -> Result<AudioDevices, String> {
    if !ffmpeg_available() {
        return Err("FFmpeg nao esta instalado ou nao esta no PATH do Windows.".into());
    }

    let output = Command::new("ffmpeg")
        .args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Nao consegui chamar o FFmpeg: {error}"))?;

    let raw = String::from_utf8_lossy(&output.stderr).to_string();
    let devices = parse_dshow_devices(&raw);

    Ok(AudioDevices {
        microphones: devices.clone(),
        system_devices: devices
            .into_iter()
            .filter(|name| {
                let lower = name.to_lowercase();
                lower.contains("stereo") || lower.contains("mix") || lower.contains("loopback")
            })
            .collect(),
        raw,
    })
}

#[tauri::command]
fn start_recording(options: RecordingOptions) -> Result<RecordingStarted, String> {
    if !ffmpeg_available() {
        return Err("FFmpeg nao esta instalado. Instale o FFmpeg e adicione ao PATH antes de gravar.".into());
    }

    let recorder = recorder();
    let mut guard = recorder.lock().map_err(|_| "Falha interna ao acessar o gravador.")?;

    if guard.is_some() {
        return Err("Ja existe uma gravacao em andamento.".into());
    }

    let output_dir = options
        .output_dir
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(default_output_dir);
    fs::create_dir_all(&output_dir).map_err(|error| {
        format!(
            "Nao consegui criar a pasta de saida '{}': {error}",
            output_dir.to_string_lossy()
        )
    })?;

    let output_path = output_dir.join(format!("gravacao-{}.mp4", timestamp()));
    let mut args = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-f".to_string(),
        "gdigrab".to_string(),
        "-framerate".to_string(),
        options.fps.clamp(15, 60).to_string(),
        "-i".to_string(),
        "desktop".to_string(),
    ];

    let mut audio_input_count = 0;

    if options.capture_microphone {
        if let Some(device) = clean_device(options.microphone_device) {
            args.extend([
                "-f".to_string(),
                "dshow".to_string(),
                "-i".to_string(),
                format!("audio={device}"),
            ]);
            audio_input_count += 1;
        }
    }

    if options.capture_system_audio {
        if let Some(device) = clean_device(options.system_audio_device) {
            args.extend([
                "-f".to_string(),
                "dshow".to_string(),
                "-i".to_string(),
                format!("audio={device}"),
            ]);
            audio_input_count += 1;
        }
    }

    args.extend(mapping_args(audio_input_count));
    args.extend(encoding_args(&options.quality));
    args.push(output_path.to_string_lossy().to_string());

    let child = Command::new("ffmpeg")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Nao consegui iniciar a gravacao: {error}"))?;

    *guard = Some(child);

    Ok(RecordingStarted {
        output_path: output_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn stop_recording() -> Result<(), String> {
    let recorder = recorder();
    let mut guard = recorder.lock().map_err(|_| "Falha interna ao acessar o gravador.")?;
    let Some(mut child) = guard.take() else {
        return Ok(());
    };

    if let Some(stdin) = child.stdin.as_mut() {
        use std::io::Write;
        let _ = stdin.write_all(b"q\n");
    }

    match child.wait() {
        Ok(_) => Ok(()),
        Err(error) => {
            let _ = child.kill();
            Err(format!("A gravacao foi interrompida com erro: {error}"))
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            list_audio_devices,
            start_recording,
            stop_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn recorder() -> &'static Mutex<Option<Child>> {
    RECORDER.get_or_init(|| Mutex::new(None))
}

fn is_recording() -> bool {
    recorder().lock().map(|guard| guard.is_some()).unwrap_or(false)
}

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn default_output_dir() -> PathBuf {
    let home = env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("Videos").join("Tela Recorder")
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn parse_dshow_devices(raw: &str) -> Vec<String> {
    let mut inside_audio_section = false;

    raw.lines()
        .filter_map(|line| {
            if line.contains("DirectShow audio devices") {
                inside_audio_section = true;
                return None;
            }

            if !inside_audio_section {
                return None;
            }

            let start = line.find('"')?;
            let rest = &line[start + 1..];
            let end = rest.find('"')?;
            Some(rest[..end].to_string())
        })
        .filter(|name| !name.trim().is_empty() && !name.contains('@'))
        .fold(Vec::new(), |mut items, item| {
            if !items.contains(&item) {
                items.push(item);
            }
            items
        })
}

fn clean_device(device: Option<String>) -> Option<String> {
    device.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn encoding_args(quality: &str) -> Vec<String> {
    let crf = match quality {
        "high" => "18",
        "balanced" => "23",
        "small" => "28",
        _ => "23",
    };

    vec![
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        crf.into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
    ]
}

fn mapping_args(audio_input_count: u8) -> Vec<String> {
    match audio_input_count {
        0 => vec!["-map".into(), "0:v".into()],
        1 => vec!["-map".into(), "0:v".into(), "-map".into(), "1:a".into()],
        _ => vec![
            "-filter_complex".into(),
            "[1:a][2:a]amix=inputs=2:duration=longest[aout]".into(),
            "-map".into(),
            "0:v".into(),
            "-map".into(),
            "[aout]".into(),
        ],
    }
}
