/**
 * Real capture. getUserMedia + MediaRecorder + a live level meter from the
 * Web Audio API. Nothing here is stubbed — only the intelligence that reads
 * the result is.
 */

export type PermissionState =
  | "idle"
  | "prompting"
  | "granted"
  | "denied"
  | "unsupported";

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
export async function requestCapture(opts: {
  video: boolean;
}): Promise<MediaStream> {
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

/**
 * Pick a container the browser will actually record.
 *
 * The mp4 entries are not an afterthought — they are the whole of Safari.
 * WebKit records mp4 and nothing else, so a candidate list that is WebM first
 * and `video/mp4` last was, on an iPhone, a list with exactly one usable entry
 * that only worked if `isTypeSupported` existed to find it. The explicit codec
 * strings are listed before the bare types because older WebKit answers
 * `isTypeSupported("video/mp4")` with false while accepting the full form.
 *
 * `undefined` means "let the browser choose", which is a legitimate answer and
 * the right one when `isTypeSupported` is missing entirely.
 */
export function pickMimeType(video: boolean): string | undefined {
  const candidates = video
    ? [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4;codecs=avc1,mp4a.40.2",
        "video/mp4",
      ]
    : [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
      ];
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
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
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

/**
 * Construct a recorder, degrading rather than throwing.
 *
 * `new MediaRecorder(...)` throws NotSupportedError when the browser cannot
 * encode what it was handed, and Safari is the browser that does it: a camera
 * stream it will not take, or a container it does not know. That throw used to
 * escape into a click handler, where it read to the player as a button that
 * does nothing at all.
 *
 * Three attempts, in order of how much is kept:
 *   1. the picked container
 *   2. whatever the browser picks for itself
 *   3. AUDIO ONLY, from the same stream
 *
 * Step 3 is worth the trouble because the video is never uploaded and never
 * scored — it exists for the on-device delivery coach and for the player's own
 * self-view. What the pitch actually needs to survive is the sound, and a
 * recorder that gives up entirely would cost a fiscal year over a container.
 */
function makeRecorder(stream: MediaStream, video: boolean): MediaRecorder {
  const mimeType = pickMimeType(video);
  if (mimeType) {
    try {
      return new MediaRecorder(stream, { mimeType });
    } catch {
      /* fall through */
    }
  }
  try {
    return new MediaRecorder(stream);
  } catch (err) {
    const audioOnly = stream.getAudioTracks();
    if (!video || audioOnly.length === 0) throw err;
    const audioStream = new MediaStream(audioOnly);
    const audioType = pickMimeType(false);
    return audioType
      ? new MediaRecorder(audioStream, { mimeType: audioType })
      : new MediaRecorder(audioStream);
  }
}

/** A started MediaRecorder plus the promise that resolves with its output. */
export function startRecording(
  stream: MediaStream,
  video: boolean,
): { recorder: MediaRecorder; done: Promise<Recording> } {
  const recorder = makeRecorder(stream, video);
  const mimeType = recorder.mimeType || pickMimeType(video);
  const chunks: BlobPart[] = [];
  const startedAt = performance.now();

  const done = new Promise<Recording>((resolve) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const durationSeconds = (performance.now() - startedAt) / 1000;
      resolve({
        blob:
          chunks.length > 0
            ? new Blob(chunks, { type: mimeType ?? "video/webm" })
            : null,
        durationSeconds,
      });
    };
    recorder.onerror = () => {
      resolve({
        blob: null,
        durationSeconds: (performance.now() - startedAt) / 1000,
      });
    };
  });

  recorder.start(250);
  return { recorder, done };
}
