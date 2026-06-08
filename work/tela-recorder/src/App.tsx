import {
  Circle,
  Clock,
  FolderOpen,
  Grid3X3,
  HardDrive,
  Keyboard,
  Library,
  ListVideo,
  Mic,
  MonitorUp,
  Pause,
  Radio,
  RefreshCw,
  Scissors,
  Search,
  Settings2,
  Square,
  Upload,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { onRecorderCommand, recorderInvoke } from "./recorderApi";

type AppStatus = {
  ffmpegAvailable: boolean;
  outputDir: string;
  activeRecording: boolean;
};

type AudioDevices = {
  microphones: string[];
  systemDevices: string[];
  raw: string;
};

type CaptureSource = {
  id: string;
  name: string;
  type: "screen" | "window";
  thumbnail: string;
};

type SavedRecording = {
  outputPath: string;
  size: number;
};

type BrowserMicDevice = {
  deviceId: string;
  label: string;
};

type EditorVideo = {
  path: string;
  name: string;
  size: number;
  modifiedAt?: number;
  extension?: string;
};

type RecordingState = "idle" | "recording" | "paused";
type AppTab = "library" | "record" | "editor" | "settings";
type OutputFormat = "webm" | "mp4";
type ShortcutConfig = {
  startStop: string;
  pause: string;
  mute: string;
  show: string;
};

const fallbackStatus: AppStatus = {
  ffmpegAvailable: false,
  outputDir: "C:\\Users\\SeuUsuario\\Videos\\Tela Recorder",
  activeRecording: false,
};

const defaultShortcuts: ShortcutConfig = {
  startStop: "Ctrl+Alt+R",
  pause: "Ctrl+Alt+P",
  mute: "Ctrl+Alt+M",
  show: "Ctrl+Alt+S",
};

function App() {
  const [status, setStatus] = useState<AppStatus>(fallbackStatus);
  const [devices, setDevices] = useState<AudioDevices>({
    microphones: [],
    systemDevices: [],
    raw: "",
  });
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [browserMicrophones, setBrowserMicrophones] = useState<BrowserMicDevice[]>([]);
  const [recordings, setRecordings] = useState<EditorVideo[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [activeTab, setActiveTab] = useState<AppTab>("library");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [fps, setFps] = useState(60);
  const [quality, setQuality] = useState("balanced");
  const [captureMic, setCaptureMic] = useState(true);
  const [captureSystem, setCaptureSystem] = useState(false);
  const [microphoneDevice, setMicrophoneDevice] = useState("");
  const [systemAudioDevice, setSystemAudioDevice] = useState("");
  const [recentRecordings, setRecentRecordings] = useState<string[]>([]);
  const [message, setMessage] = useState("Escolha uma tela ou janela para gravar.");
  const [isBusy, setIsBusy] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [micTestActive, setMicTestActive] = useState(false);
  const [micLevel, setMicLevel] = useState(8);
  const [editorVideo, setEditorVideo] = useState<EditorVideo | null>(null);
  const [editorStart, setEditorStart] = useState(0);
  const [editorEnd, setEditorEnd] = useState(10);
  const [editorDuration, setEditorDuration] = useState(0);
  const [shortcuts, setShortcuts] = useState<ShortcutConfig>(() => loadShortcuts());
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(() => loadOutputFormat());

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micAnimationRef = useRef<number | null>(null);
  const editorVideoRef = useRef<HTMLVideoElement | null>(null);

  const selectedSource = sources.find((source) => source.id === selectedSourceId);
  const meters = useMemo(
    () => ({
      mic: recordingState === "recording" && captureMic ? 74 : 18,
      system: recordingState === "recording" && captureSystem ? 58 : 10,
    }),
    [captureMic, captureSystem, recordingState],
  );

  useEffect(() => {
    void refreshStatus();
    void recorderInvoke("register_shortcuts", shortcuts);
    void refreshRecordings();
    return () => {
      stopStream(activeStreamRef.current);
      stopStream(previewStreamRef.current);
      stopMicTest();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("tela-recorder-shortcuts", JSON.stringify(shortcuts));
    void recorderInvoke("register_shortcuts", shortcuts);
  }, [shortcuts]);

  useEffect(() => {
    localStorage.setItem("tela-recorder-output-format", outputFormat);
  }, [outputFormat]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const accelerator = formatShortcutEvent(event);
      if (!accelerator) return;
      if (accelerator === shortcuts.startStop) {
        event.preventDefault();
        recordingState === "idle" ? void startRecording() : void stopRecording();
      }
      if (accelerator === shortcuts.pause) {
        event.preventDefault();
        togglePause();
      }
      if (accelerator === shortcuts.mute) {
        event.preventDefault();
        toggleMicMute();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    return onRecorderCommand((command) => {
      if (command === "start") {
        void startRecording();
      }
      if (command === "toggle-recording") {
        recordingState === "idle" ? void startRecording() : void stopRecording();
      }
      if (command === "stop") {
        void stopRecording();
      }
      if (command === "pause") {
        togglePause();
      }
      if (command === "mute") {
        toggleMicMute();
      }
    });
  });

  useEffect(() => {
    if (!selectedSourceId) {
      return;
    }

    void showPreview(selectedSourceId);
  }, [selectedSourceId, fps]);

  async function refreshStatus() {
    try {
      const nextStatus = await recorderInvoke<AppStatus>("get_app_status");
      setStatus(nextStatus);
      await Promise.all([refreshDevices(), refreshSources()]);
      setMessage("Motor fluido pronto. Escolha uma fonte e grave.");
    } catch (error) {
      setMessage(`Backend indisponivel: ${String(error)}`);
    }
  }

  async function refreshDevices() {
    try {
      const nextDevices = await recorderInvoke<AudioDevices>("list_audio_devices");
      const nextBrowserMicrophones = await listBrowserMicrophones();
      setDevices(nextDevices);
      setBrowserMicrophones(nextBrowserMicrophones);
      setMicrophoneDevice((current) => current || nextBrowserMicrophones[0]?.deviceId || "");
      setSystemAudioDevice((current) => current || nextDevices.systemDevices[0] || "");
      setCaptureSystem(nextDevices.systemDevices.length > 0);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function refreshSources() {
    const nextSources = await recorderInvoke<CaptureSource[]>("list_capture_sources");
    setSources(nextSources);
    setSelectedSourceId((current) => current || nextSources[0]?.id || "");
    return nextSources;
  }

  async function refreshRecordings() {
    const items = await recorderInvoke<EditorVideo[]>("list_recordings");
    setRecordings(items);
  }

  async function showPreview(sourceId: string) {
    try {
      stopStream(previewStreamRef.current);
      const stream = await createDesktopStream(sourceId, Math.min(fps, 30));
      previewStreamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play();
      }
    } catch (error) {
      setMessage(`Nao consegui abrir preview: ${String(error)}`);
    }
  }

  async function startRecording() {
    let sourceId = selectedSourceId;
    let source = selectedSource;

    if (!sourceId) {
      const nextSources = await refreshSources();
      sourceId = nextSources[0]?.id || "";
      source = nextSources[0];
    }

    if (!sourceId) {
      setMessage("Escolha uma tela ou janela antes de gravar.");
      return;
    }

    setIsBusy(true);
    try {
      const screenStream = await createDesktopStream(sourceId, fps);
      const tracks = [...screenStream.getVideoTracks()];

      if (captureMic) {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: microphoneDevice ? { deviceId: { exact: microphoneDevice } } : true,
          video: false,
        });
        tracks.push(...micStream.getAudioTracks());
      }

      const stream = new MediaStream(tracks);
      activeStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !micMuted;
      });
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, {
        mimeType: bestMimeType(),
        videoBitsPerSecond: qualityBitrate(quality),
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start(1000);
      setRecordingState("recording");
      await recorderInvoke("overlay_show");
      setMessage(`Gravando: ${source?.name || "fonte selecionada"}`);
    } catch (error) {
      stopStream(activeStreamRef.current);
      activeStreamRef.current = null;
      setMessage(`Nao consegui iniciar a gravacao fluida: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function stopRecording() {
    if (!recorderRef.current || recorderRef.current.state === "inactive") {
      setRecordingState("idle");
      return;
    }

    setIsBusy(true);
    try {
      const blob = await stopMediaRecorder(recorderRef.current, chunksRef.current);
      const data = await blob.arrayBuffer();
      const result = await recorderInvoke<SavedRecording>("save_media_recording", {
        data,
        extension: "webm",
        outputDir: status.outputDir,
      });

      stopStream(activeStreamRef.current);
      activeStreamRef.current = null;
      recorderRef.current = null;
      await recorderInvoke("overlay_hide");
      setRecordingState("idle");
      setRecentRecordings((items) => [result.outputPath, ...items].slice(0, 5));
      if (outputFormat === "mp4") {
        setMessage("Gravacao salva. Gerando MP4 em alta qualidade...");
        const mp4 = await recorderInvoke<EditorVideo>("convert_to_mp4", { path: result.outputPath, quality });
        setRecentRecordings((items) => [mp4.path, ...items].slice(0, 5));
        setMessage(`MP4 exportado (${formatBytes(mp4.size)}): ${mp4.path}`);
      } else {
        setMessage(`Gravacao fluida salva (${formatBytes(result.size)}): ${result.outputPath}`);
      }
      await refreshRecordings();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setIsBusy(false);
    }
  }

  function togglePause() {
    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }

    if (recorder.state === "recording") {
      recorder.pause();
      setRecordingState("paused");
      setMessage("Gravacao pausada.");
      return;
    }

    if (recorder.state === "paused") {
      recorder.resume();
      setRecordingState("recording");
      setMessage("Gravacao retomada.");
    }
  }

  function toggleMicMute() {
    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    activeStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMessage(nextMuted ? "Microfone mutado." : "Microfone ativo.");
  }

  async function startMicTest() {
    if (micTestActive) {
      stopMicTest();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneDevice ? { deviceId: { exact: microphoneDevice } } : true,
        video: false,
      });
      micTestStreamRef.current = stream;
      setMicTestActive(true);

      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.fftSize = 512;
      source.connect(analyser);

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const centered = value - 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / data.length);
        setMicLevel(Math.min(100, Math.max(4, Math.round(rms * 4))));
        micAnimationRef.current = requestAnimationFrame(tick);
      };
      tick();

      setMessage("Teste de microfone ativo. Fala alguma coisa e olha o nivel.");
    } catch (error) {
      setMessage(`Nao consegui testar o microfone: ${String(error)}`);
    }
  }

  function stopMicTest() {
    if (micAnimationRef.current) {
      cancelAnimationFrame(micAnimationRef.current);
      micAnimationRef.current = null;
    }
    stopStream(micTestStreamRef.current);
    micTestStreamRef.current = null;
    setMicTestActive(false);
    setMicLevel(8);
  }

  async function openEditorVideo() {
    const video = await recorderInvoke<EditorVideo | null>("open_video_file");
    if (!video) {
      return;
    }

    setActiveTab("editor");
    setEditorVideo(video);
    setEditorStart(0);
    setEditorEnd(10);
    setMessage(`Video carregado no editor: ${video.name}`);
  }

  function openRecordingInEditor(video: EditorVideo) {
    setActiveTab("editor");
    setEditorVideo(video);
    setEditorStart(0);
    setEditorEnd(10);
    setMessage(`Video carregado no editor: ${video.name}`);
  }

  async function deleteRecording(video: EditorVideo) {
    await recorderInvoke("delete_recording", { path: video.path });
    await refreshRecordings();
    setMessage(`Arquivo excluido: ${video.name}`);
  }

  async function renameRecording(video: EditorVideo) {
    const name = window.prompt("Novo nome do arquivo", video.name.replace(/\.[^.]+$/, ""));
    if (!name) return;
    const renamed = await recorderInvoke<EditorVideo>("rename_recording", { path: video.path, name });
    await refreshRecordings();
    setMessage(`Renomeado para: ${renamed.name}`);
  }

  async function convertRecording(video: EditorVideo) {
    setIsBusy(true);
    try {
      setMessage(`Convertendo para MP4: ${video.name}`);
      const converted = await recorderInvoke<EditorVideo>("convert_to_mp4", { path: video.path, quality });
      await refreshRecordings();
      setMessage(`MP4 pronto (${formatBytes(converted.size)}): ${converted.path}`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function exportTrim() {
    if (!editorVideo) {
      setMessage("Escolha um video antes de exportar.");
      return;
    }

    setIsBusy(true);
    try {
      const result = await recorderInvoke<SavedRecording>("export_trim", {
        inputPath: editorVideo.path,
        start: editorStart,
        end: Math.min(editorEnd, editorDuration || editorEnd),
      });
      setRecentRecordings((items) => [result.outputPath, ...items].slice(0, 5));
      await refreshRecordings();
      setMessage(`Corte exportado (${formatBytes(result.size)}): ${result.outputPath}`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setIsBusy(false);
    }
  }

  function updateShortcut(key: keyof ShortcutConfig, value: string) {
    setShortcuts((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Studio recorder</p>
          <h1>REC</h1>
        </div>
        <div className="top-actions">
          <div className="search-box">
            <Search size={18} />
            <span>Search library...</span>
          </div>
          <div className="status-pill ready">
            <Radio size={16} />
            Captura fluida
          </div>
        </div>
      </section>

      <section className="studio-layout">
        <aside className="app-sidebar">
          <div>
            <p className="sidebar-label">Library</p>
            <button className={activeTab === "library" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("library")}>
              <Library size={20} />
              Biblioteca
            </button>
            <button className={activeTab === "record" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("record")}>
              <Grid3X3 size={20} />
              Gravador
            </button>
            <button className={activeTab === "editor" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("editor")}>
              <Scissors size={20} />
              Editor
            </button>
            <button className="nav-item" onClick={openEditorVideo}>
              <ListVideo size={20} />
              Importar video
            </button>
          </div>
          <div>
            <p className="sidebar-label">Settings</p>
            <button className={activeTab === "settings" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("settings")}>
              <Keyboard size={20} />
              Hotkeys
            </button>
          </div>
          <div className="storage-card">
            <div>
              <HardDrive size={17} />
              <span>Storage</span>
              <b>82%</b>
            </div>
            <i />
          </div>
        </aside>
        <div className="studio-main">

      {activeTab === "library" ? (
      <section className="library-workspace">
        <div className="library-header">
          <div>
            <h2>All Videos</h2>
            <span>{recordings.length} arquivos em Videos\\Tela Recorder</span>
          </div>
          <button className="secondary-button" onClick={refreshRecordings}>
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>
        <div className="media-grid">
          {recordings.length === 0 ? (
            <button className="import-drop" onClick={() => setActiveTab("record")}>
              <Circle size={22} />
              Grave seu primeiro video
            </button>
          ) : (
            recordings.map((video) => (
              <article className="media-card" key={video.path}>
                <button className="media-thumb" onClick={() => openRecordingInEditor(video)}>
                  <video src={filePathToSrc(video.path)} muted preload="metadata" />
                  <b>{(video.extension || "video").toUpperCase()}</b>
                </button>
                <h3>{video.name}</h3>
                <p>{formatDate(video.modifiedAt)} · {formatBytes(video.size)}</p>
                <div className="card-actions">
                  <button onClick={() => openRecordingInEditor(video)}>Editar</button>
                  <button disabled={isBusy || video.extension === "mp4"} onClick={() => convertRecording(video)}>MP4</button>
                  <button onClick={() => renameRecording(video)}>Nome</button>
                  <button onClick={() => deleteRecording(video)}>Excluir</button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      ) : activeTab === "record" ? (
      <section className="workspace">
        <div className="preview-panel">
          <div className="preview-toolbar">
            <span>{selectedSource?.type === "window" ? "Janela" : "Tela"}</span>
            <span>{fps} FPS</span>
            <span>{qualityLabel(quality)}</span>
            <span>{selectedSource?.name || "Nenhuma fonte"}</span>
          </div>
          <div className="preview-canvas">
            <video ref={previewRef} className="live-preview" muted playsInline />
            <div className={`record-badge ${recordingState}`}>
              <span />
              {recordingState === "recording" ? "REC" : recordingState === "paused" ? "PAUSADO" : "STANDBY"}
            </div>
          </div>

          <div className="controls">
            <button
              className="record-button"
              disabled={isBusy || recordingState !== "idle"}
              onClick={startRecording}
              title="Iniciar gravacao"
            >
              <Circle size={22} fill="currentColor" />
              REC
            </button>
            <button
              className="icon-button"
              disabled={recordingState === "idle"}
              onClick={togglePause}
              title="Pausar"
            >
              <Pause size={20} />
            </button>
            <button
              className="icon-button stop"
              disabled={isBusy || recordingState === "idle"}
              onClick={stopRecording}
              title="Parar e salvar"
            >
              <Square size={18} fill="currentColor" />
            </button>
          </div>
        </div>

        <aside className="side-panel">
          <section className="panel-block">
            <div className="block-title">
              <MonitorUp size={18} />
              Fonte
            </div>
            <button className="secondary-button" onClick={refreshSources}>
              <RefreshCw size={16} />
              Atualizar janelas
            </button>
            <div className="source-list">
              {sources.map((source) => (
                <button
                  className={source.id === selectedSourceId ? "source-card active" : "source-card"}
                  key={source.id}
                  onClick={() => setSelectedSourceId(source.id)}
                  title={source.name}
                >
                  <img src={source.thumbnail} alt="" />
                  <span>{source.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-block">
            <div className="block-title">
              <Settings2 size={18} />
              Captura
            </div>
            <div className="segmented">
              {[30, 60].map((value) => (
                <button key={value} className={fps === value ? "active" : ""} onClick={() => setFps(value)}>
                  {value}
                </button>
              ))}
            </div>
            <select value={quality} onChange={(event) => setQuality(event.target.value)}>
              <option value="high">Upload premium</option>
              <option value="balanced">Alta qualidade</option>
              <option value="small">Arquivo menor</option>
            </select>
            <div className="segmented">
              {(["mp4", "webm"] as OutputFormat[]).map((format) => (
                <button key={format} className={outputFormat === format ? "active" : ""} onClick={() => setOutputFormat(format)}>
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          </section>

          <section className="panel-block">
            <div className="block-title">
              <Mic size={18} />
              Microfone
            </div>
            <label className="toggle-row">
              <input type="checkbox" checked={captureMic} onChange={(event) => setCaptureMic(event.target.checked)} />
              Capturar microfone
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={micMuted} onChange={toggleMicMute} />
              Iniciar mutado
            </label>
            <select value={microphoneDevice} onChange={(event) => setMicrophoneDevice(event.target.value)}>
              <option value="">Microfone padrao</option>
              {browserMicrophones.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
            <AudioMeter label="Nivel" value={micTestActive ? micLevel : meters.mic} />
            <button className="secondary-button" onClick={startMicTest}>
              <Mic size={16} />
              {micTestActive ? "Parar teste" : "Testar microfone"}
            </button>
          </section>

          <section className="panel-block">
            <div className="block-title">
              <Volume2 size={18} />
              Audio do PC
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={captureSystem}
                disabled={devices.systemDevices.length === 0}
                onChange={(event) => setCaptureSystem(event.target.checked)}
              />
              Capturar som do sistema
            </label>
            <select value={systemAudioDevice} onChange={(event) => setSystemAudioDevice(event.target.value)}>
              <option value="">Sem Stereo Mix/Loopback</option>
              {devices.systemDevices.map((device) => (
                <option key={device} value={device}>
                  {device}
                </option>
              ))}
            </select>
            <AudioMeter label="Nivel" value={meters.system} />
          </section>

          <section className="panel-block">
            <div className="block-title">
              <FolderOpen size={18} />
              Saida
            </div>
            <p className="path-text">{status.outputDir}</p>
            <button className="secondary-button" onClick={refreshStatus}>
              <RefreshCw size={16} />
              Atualizar tudo
            </button>
          </section>
        </aside>
      </section>
      ) : activeTab === "editor" ? (
      <section className="editor-workspace">
        <div className="editor-panel">
          <div className="preview-toolbar">
            <span>{editorVideo?.name || "Nenhum video"}</span>
            <span>{editorDuration ? `${editorDuration.toFixed(1)}s` : "duracao -"}</span>
          </div>
          <div className="editor-canvas">
            {editorVideo ? (
              <video
                ref={editorVideoRef}
                className="editor-video"
                controls
                src={filePathToSrc(editorVideo.path)}
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration || 0;
                  setEditorDuration(duration);
                  setEditorEnd(Number(duration.toFixed(1)));
                }}
              />
            ) : (
              <button className="import-drop" onClick={openEditorVideo}>
                <Upload size={26} />
                Importar video
              </button>
            )}
          </div>
        </div>

        <aside className="side-panel">
          <section className="panel-block">
            <div className="block-title">
              <Scissors size={18} />
              Corte rapido
            </div>
            <button className="secondary-button" onClick={openEditorVideo}>
              <Upload size={16} />
              Abrir video
            </button>
            <div className="time-pair">
              <label className="field-label">
                Inicio
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={editorStart}
                  onChange={(event) => setEditorStart(Math.min(Number(event.target.value), editorEnd - 0.1))}
                />
              </label>
              <label className="field-label">
                Fim
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={editorEnd}
                  onChange={(event) => setEditorEnd(Math.max(Number(event.target.value), editorStart + 0.1))}
                />
              </label>
            </div>
            <div className="timeline-strip">
              <i
                style={{
                  left: `${durationPercent(editorStart, editorDuration)}%`,
                  width: `${Math.max(2, durationPercent(editorEnd - editorStart, editorDuration))}%`,
                }}
              />
            </div>
            <label className="field-label">
              Arrastar inicio
              <input
                type="range"
                min="0"
                max={editorDuration || 1}
                step="0.1"
                value={editorStart}
                onChange={(event) => setEditorStart(Math.min(Number(event.target.value), editorEnd - 0.1))}
              />
            </label>
            <label className="field-label">
              Arrastar fim
              <input
                type="range"
                min="0"
                max={editorDuration || 1}
                step="0.1"
                value={editorEnd}
                onChange={(event) => setEditorEnd(Math.max(Number(event.target.value), editorStart + 0.1))}
              />
            </label>
            <button className="record-button editor-export" disabled={isBusy || !editorVideo} onClick={exportTrim}>
              <Scissors size={18} />
              Exportar corte
            </button>
          </section>
        </aside>
      </section>
      ) : (
      <section className="settings-workspace">
        <div className="settings-panel">
          <div className="section-heading">
            <h2>Workflow Hotkeys</h2>
            <span>Atalhos globais e dentro do app</span>
          </div>
          <div className="hotkey-grid">
            <HotkeyField label="Iniciar / parar" value={shortcuts.startStop} onChange={(value) => updateShortcut("startStop", value)} />
            <HotkeyField label="Pausar / retomar" value={shortcuts.pause} onChange={(value) => updateShortcut("pause", value)} />
            <HotkeyField label="Mutar microfone" value={shortcuts.mute} onChange={(value) => updateShortcut("mute", value)} />
            <HotkeyField label="Mostrar app" value={shortcuts.show} onChange={(value) => updateShortcut("show", value)} />
          </div>
          <div className="settings-note">
            <Clock size={18} />
            Clique em um campo e pressione a combinacao desejada. O Electron registra os atalhos globalmente enquanto o REC estiver aberto.
          </div>
        </div>
      </section>
      )}

      <section className="bottom-grid">
        <div className="message-strip">
          <MonitorUp size={18} />
          <span>{message}</span>
        </div>
        <div className="recordings">
          <h2>Ultimas gravacoes</h2>
          {recentRecordings.length === 0 ? (
            <p>Nenhuma gravacao nesta sessao.</p>
          ) : (
            recentRecordings.map((recording) => <p key={recording}>{recording}</p>)
          )}
        </div>
      </section>
        </div>
      </section>
    </main>
  );
}

async function listBrowserMicrophones(): Promise<BrowserMicDevice[]> {
  try {
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stopStream(permissionStream);
  } catch {
    return [];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Microfone ${index + 1}`,
    }));
}

async function createDesktopStream(sourceId: string, fps: number) {
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: fps,
      },
    },
  };

  return navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints);
}

function filePathToSrc(filePath: string) {
  return encodeURI(`file:///${filePath.replace(/\\/g, "/")}`);
}

function durationPercent(value: number, duration: number) {
  if (!duration) return 0;
  return Math.max(0, Math.min(100, (value / duration) * 100));
}

function stopMediaRecorder(recorder: MediaRecorder, chunks: BlobPart[]) {
  return new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    };
    recorder.stop();
  });
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function bestMimeType() {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

function qualityBitrate(quality: string) {
  if (quality === "high") return 45_000_000;
  if (quality === "small") return 12_000_000;
  return 28_000_000;
}

function loadOutputFormat(): OutputFormat {
  const saved = localStorage.getItem("tela-recorder-output-format");
  if (saved === "webm" || saved === "mp4") {
    return saved;
  }
  return localStorage.getItem("tela-recorder-auto-mp4") === "false" ? "webm" : "mp4";
}

function loadShortcuts(): ShortcutConfig {
  try {
    const saved = localStorage.getItem("tela-recorder-shortcuts");
    return saved ? { ...defaultShortcuts, ...JSON.parse(saved) } : defaultShortcuts;
  } catch {
    return defaultShortcuts;
  }
}

function formatShortcutEvent(event: KeyboardEvent | React.KeyboardEvent) {
  const key = event.key.length === 1 ? event.key.toUpperCase() : normalizeKey(event.key);
  if (!key || ["CONTROL", "SHIFT", "ALT", "META"].includes(key.toUpperCase())) {
    return "";
  }

  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("CommandOrControl");
  parts.push(key);
  return parts.join("+");
}

function normalizeKey(key: string) {
  const map: Record<string, string> = {
    " ": "Space",
    Escape: "Esc",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };

  return map[key] || key;
}

function HotkeyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="hotkey-field">
      <span>{label}</span>
      <input
        value={value}
        readOnly
        onKeyDown={(event) => {
          event.preventDefault();
          const accelerator = formatShortcutEvent(event);
          if (accelerator) {
            onChange(accelerator);
          }
        }}
        onFocus={(event) => event.currentTarget.select()}
      />
    </label>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value?: number) {
  if (!value) return "sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function AudioMeter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <div>
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function qualityLabel(value: string) {
  if (value === "high") return "Premium";
  if (value === "small") return "Compacta";
  return "Alta";
}

export default App;
