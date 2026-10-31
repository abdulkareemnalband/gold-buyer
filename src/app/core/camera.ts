/**
 * The live camera, shared by the photo dialog and the barcode dialog.
 *
 * A phone shows each back lens as its own camera, such as wide and ultra wide. The user
 * picks one, and this browser remembers it. Zoom, torch, and focus mode are not in every
 * browser, and the TypeScript DOM library does not describe them yet, so this file
 * declares the small part it uses and checks each one before use.
 */

export interface CameraInfo {
  id: string;
  label: string;
}

/** The controls that the open camera supports. A missing control is undefined or false. */
export interface CameraControls {
  zoom?: { min: number; max: number; step: number };
  torch: boolean;
}

interface ExtraCapabilities {
  zoom?: { min: number; max: number; step?: number };
  torch?: boolean;
  focusMode?: string[];
}

/** The key for the camera from the last visit. It is a convenience for this browser only. */
const CAMERA_KEY = 'gold-buyer.camera';

const SIZE = { width: { ideal: 1920 }, height: { ideal: 1080 } };

export function hasLiveCamera(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Open a camera. With no device id, use the camera from the last visit. When that camera
 * is gone, for example on another phone, fall back to the default rear camera.
 *
 * A switch that the user starts passes `fallback` false. A failed switch then throws, so
 * the dialog can reopen the camera the user had, and does not move to another in silence.
 *
 * Throws when the user blocks the camera or the device has none.
 */
export async function openCamera(deviceId = recallCamera(), fallback = true): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, ...SIZE },
        audio: false,
      });
    } catch (error) {
      if (!fallback) {
        throw error;
      }
      rememberCamera('');
    }
  }

  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, ...SIZE },
    audio: false,
  });
}

/** Stop every track of a stream, so the camera light goes off. */
export function closeCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** The device id of the camera that a stream comes from. */
export function cameraIdOf(stream: MediaStream): string {
  return stream.getVideoTracks()[0]?.getSettings().deviceId ?? '';
}

/**
 * The cameras of this device. The browser gives their names only after the user allows
 * the camera, so call this after `openCamera`.
 */
export async function listCameras(): Promise<CameraInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput' && device.deviceId)
      .map((device, index) => ({
        id: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));
  } catch {
    return [];
  }
}

/**
 * Turn on continuous autofocus where the camera supports it, and report the zoom and the
 * torch. A camera with no such controls gives an empty result.
 */
export async function prepareCamera(stream: MediaStream): Promise<CameraControls> {
  const track = stream.getVideoTracks()[0];
  const capabilities = (track?.getCapabilities?.() ?? {}) as ExtraCapabilities;

  if (capabilities.focusMode?.includes('continuous')) {
    await applyAdvanced(track, { focusMode: 'continuous' });
  }

  const zoom = capabilities.zoom;
  return {
    zoom:
      zoom && zoom.max > zoom.min
        ? { min: zoom.min, max: zoom.max, step: zoom.step || 0.1 }
        : undefined,
    torch: capabilities.torch === true,
  };
}

export async function setZoom(stream: MediaStream | null, zoom: number): Promise<void> {
  await applyAdvanced(stream?.getVideoTracks()[0], { zoom });
}

export async function setTorch(stream: MediaStream | null, on: boolean): Promise<void> {
  await applyAdvanced(stream?.getVideoTracks()[0], { torch: on });
}

/** A camera control that the browser rejects is not an error. The view stays as it was. */
async function applyAdvanced(
  track: MediaStreamTrack | undefined,
  constraint: Record<string, unknown>,
): Promise<void> {
  try {
    await track?.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] });
  } catch {
    // The camera does not support this control.
  }
}

export function recallCamera(): string {
  try {
    return localStorage.getItem(CAMERA_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberCamera(deviceId: string): void {
  try {
    if (deviceId) {
      localStorage.setItem(CAMERA_KEY, deviceId);
    } else {
      localStorage.removeItem(CAMERA_KEY);
    }
  } catch {
    // Storage can be blocked. The dialogs then open the default camera each time.
  }
}
