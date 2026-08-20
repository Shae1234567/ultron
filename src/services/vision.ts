import { GoogleGenAI } from '@google/genai';

// "Visual Awareness" - real webcam capture piped into Gemini for actual scene
// understanding (not simulated). This lives in the renderer because Electron's
// main process has no getUserMedia; the browser/renderer is the only place that
// can talk to the webcam. describeImage() is the counterpart that turns a raw
// capture (from here, or from electron/vision.ts's screen capture) into an
// actual described answer via Gemini's vision-capable model. IPC wiring
// (vision:capture / vision:listSources channels, preload bridge) is left to
// whoever integrates this.

export interface WebcamCaptureResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

/** Grabs a single frame from the default webcam as a PNG data URL, then releases the camera. */
export async function captureWebcamFrame(): Promise<WebcamCaptureResult> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    // Wait for at least one frame's worth of dimensions to be available.
    if (!video.videoWidth || !video.videoHeight) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for webcam frame.')), 5000);
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { ok: false, error: 'Failed to acquire 2D canvas context.' };
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/png');
    return { ok: true, dataUrl };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  } finally {
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      }
    }
  }
}

export interface DescribeImageResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/** Sends a captured image (screen or webcam) plus a text prompt to Gemini's vision model. */
export async function describeImage(dataUrl: string, prompt: string, apiKey: string): Promise<DescribeImageResult> {
  try {
    if (!apiKey) {
      return { ok: false, error: 'No Gemini API key provided.' };
    }

    const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (!match) {
      return { ok: false, error: 'Expected a data:image/png;base64,... data URL.' };
    }
    const base64Data = match[1];

    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/png', data: base64Data } },
          ],
        },
      ],
    });

    return { ok: true, text: result.text?.trim() ?? '' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
