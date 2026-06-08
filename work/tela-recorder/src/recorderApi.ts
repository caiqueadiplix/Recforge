import { invoke as tauriInvoke } from "@tauri-apps/api/core";

type ElectronRecorder = {
  invoke: <T>(command: string, payload?: unknown) => Promise<T>;
  onCommand?: (callback: (command: string) => void) => () => void;
};

declare global {
  interface Window {
    recorder?: ElectronRecorder;
  }
}

export async function recorderInvoke<T>(command: string, payload?: unknown): Promise<T> {
  if (window.recorder) {
    return window.recorder.invoke<T>(command, payload);
  }

  return tauriInvoke<T>(command, payload as Record<string, unknown> | undefined);
}

export function onRecorderCommand(callback: (command: string) => void) {
  if (!window.recorder?.onCommand) {
    return () => undefined;
  }

  return window.recorder.onCommand(callback);
}
