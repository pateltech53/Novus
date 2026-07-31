/**
 * Real capture. getUserMedia + MediaRecorder + a live level meter from the
 * Web Audio API. Nothing here is stubbed — only the intelligence that reads
 * the result is.
 */

export type PermissionState = "idle" | "prompting" | "granted" | "denied" | "unsupported";

export interface CaptureHandles {
  stream: MediaStream;
  stop(): void;
}

export function mediaSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined"
  );
}

/** Camera + mic for a pitch; audio-only for the onboarding mic moment. */
export async function requestCapture(opts: { video: boolean }): Promise<MediaStream> {
  if (!mediaSupported()) throw new Error("unsupported");
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false, // the level meter must see the real signal
    },
    video: opts.video
      ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
      : false,
  });
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Pick a container the browser will actually record. */
export function pickMimeType(video: boolean): string | undefined {
  const candidates = video
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return undefined;
}

export interface LevelMeter {
  /** 0..1 RMS of the live signal. */
  read(): number;
  close(): void;
}

export function createLevelMeter(stream: MediaStream): LevelMeter {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.65;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);

  return {
    read() {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
      const rms = Math.sqrt(sum / buffer.length);
      // Perceptual curve: quiet rooms shouldn't read as silence.
      return Math.min(1, Math.pow(rms * 4.5, 0.65));
    },
    close() {
      source.disconnect();
      analyser.disconnect();
      void ctx.close();
    },
  };
}

export interface Recording {
  blob: Blob | null;
  durationSeconds: number;
}

/** A started MediaRecorder plus the promise that resolves with its output. */
export function startRecording(
  stream: MediaStream,
  video: boolean,
): { recorder: MediaRecorder; done: Promise<Recording> } {
  const mimeType = pickMimeType(video);
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  const startedAt = performance.now();

  const done = new Promise<Recording>((resolve) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const durationSeconds = (performance.now() - startedAt) / 1000;
      resolve({
        blob: chunks.length > 0 ? new Blob(chunks, { type: mimeType ?? "video/webm" }) : null,
        durationSeconds,
      });
    };
    recorder.onerror = () => {
      resolve({ blob: null, durationSeconds: (performance.now() - startedAt) / 1000 });
    };
  });

  recorder.start(250);
  return { recorder, done };
}
