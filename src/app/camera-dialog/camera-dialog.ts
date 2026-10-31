import {
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  CameraInfo,
  cameraIdOf,
  closeCamera,
  hasLiveCamera,
  listCameras,
  openCamera,
  prepareCamera,
  rememberCamera,
} from '../core/camera';
import { CameraPicker } from '../camera-picker/camera-picker';

interface Shot {
  id: string;
  blob: Blob;
  url: string;
}

/**
 * A camera that takes several photos in one go.
 *
 * A file input with `capture` opens the phone camera for one photo only, and a phone
 * ignores `multiple` on it. This dialog shows the live rear camera with `getUserMedia`
 * instead. Each tap on Take photo adds one frame. Save sends them all at once.
 *
 * When the browser has no camera API, or the user blocks the camera, the dialog offers
 * the one-photo camera input as a fallback.
 */
@Component({
  selector: 'app-camera-dialog',
  imports: [CameraPicker],
  template: `
    <dialog
      #dialog
      class="sheet max-h-[95dvh] overflow-y-auto sm:max-w-2xl"
      aria-labelledby="camera-title"
      (close)="onDialogClose()"
    >
      <h2 id="camera-title" class="mb-3 text-lg font-semibold">Photos of {{ label() }}</h2>

      @if (error()) {
        <p class="mb-3 text-sm text-rose-700 dark:text-rose-400" role="alert">{{ error() }}</p>
        <label class="btn-quiet mb-3 cursor-pointer">
          <span>Use the one-photo camera</span>
          <input
            class="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            (change)="pickFallback($event)"
          />
        </label>
      } @else {
        <app-camera-picker
          [cameras]="cameras()"
          [cameraId]="cameraId()"
          [busy]="switching()"
          (picked)="switchCamera($event)"
        />
        @if (notice()) {
          <p class="mb-2 text-xs text-rose-700 dark:text-rose-400" role="alert">{{ notice() }}</p>
        }

        <video
          #video
          class="max-h-[55dvh] w-full rounded-lg bg-black object-contain"
          playsinline
          muted
          [attr.aria-label]="'Live camera view for photos of ' + label()"
        ></video>

        <button
          type="button"
          class="btn-primary mt-3 w-full"
          [disabled]="!ready()"
          (click)="snap()"
        >
          {{ ready() ? 'Take photo' : 'Opening the camera…' }}
        </button>
      }

      <p class="muted mt-3 text-sm" role="status" aria-live="polite">
        {{ shots().length }} {{ shots().length === 1 ? 'photo' : 'photos' }} taken
      </p>

      @if (shots().length > 0) {
        <ul class="mt-2 flex flex-wrap gap-2" aria-label="Photos taken">
          @for (shot of shots(); track shot.id; let index = $index) {
            <li class="relative">
              <img
                class="h-16 w-16 rounded-lg border border-stone-300 object-cover dark:border-stone-700"
                [src]="shot.url"
                width="64"
                height="64"
                [alt]="'Photo ' + (index + 1) + ' taken'"
              />
              <button
                type="button"
                class="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full border border-stone-300 bg-white text-sm text-rose-800 focus-visible:outline-2 focus-visible:outline-amber-700 dark:border-stone-700 dark:bg-stone-900 dark:text-rose-300 dark:focus-visible:outline-amber-400"
                [attr.aria-label]="'Remove photo ' + (index + 1)"
                (click)="remove(shot.id)"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          }
        </ul>
      }

      <div class="mt-4 flex gap-2">
        <button
          type="button"
          class="btn-primary flex-1"
          [disabled]="shots().length === 0"
          (click)="save()"
        >
          Save {{ shots().length }} {{ shots().length === 1 ? 'photo' : 'photos' }}
        </button>
        <button type="button" class="btn-quiet" (click)="cancel()">Cancel</button>
      </div>
    </dialog>
  `,
})
export class CameraDialog {
  readonly open = input.required<boolean>();
  readonly label = input('this article');
  /** The photos to keep. The parent stores them. */
  readonly saved = output<File[]>();
  readonly closed = output<void>();

  protected readonly shots = signal<Shot[]>([]);
  protected readonly ready = signal(false);
  protected readonly error = signal('');

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  protected readonly cameras = signal<CameraInfo[]>([]);
  /** The device id of the open camera. */
  protected readonly cameraId = signal('');
  /** True while a camera switch runs. */
  protected readonly switching = signal(false);
  /** A short note about the last switch. */
  protected readonly notice = signal('');

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;

      if (this.open()) {
        if (!dialog.open) {
          dialog.showModal();
          void untracked(() => this.start());
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });

    inject(DestroyRef).onDestroy(() => {
      this.stop();
      this.clear();
    });
  }

  /** Copy the current camera frame into a JPEG. */
  protected snap(): void {
    const video = this.video()?.nativeElement;

    if (!video || video.videoWidth === 0) {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const shot = { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) };
          this.shots.update((shots) => [...shots, shot]);
        }
      },
      'image/jpeg',
      0.9,
    );
  }

  protected remove(id: string): void {
    const shot = this.shots().find((one) => one.id === id);

    if (shot) {
      URL.revokeObjectURL(shot.url);
      this.shots.update((shots) => shots.filter((one) => one.id !== id));
    }
  }

  protected save(): void {
    const stamp = Date.now();
    const files = this.shots().map(
      (shot, index) =>
        new File([shot.blob], `photo-${stamp}-${index + 1}.jpg`, { type: 'image/jpeg' }),
    );

    this.saved.emit(files);
    this.finish();
  }

  protected cancel(): void {
    this.finish();
  }

  /** The one-photo camera input. Its photo joins the photos taken so far. */
  protected pickFallback(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (file) {
      const shot = { id: crypto.randomUUID(), blob: file, url: URL.createObjectURL(file) };
      this.shots.update((shots) => [...shots, shot]);
    }
  }

  /** Escape closes the dialog without a tap on Cancel. Treat it as a cancel. */
  protected onDialogClose(): void {
    this.stop();
    this.clear();
    this.closed.emit();
  }

  private finish(): void {
    this.stop();
    this.clear();
    this.closed.emit();
  }

  /**
   * Open another camera, such as the ultra wide lens. This browser remembers it. When
   * the camera does not open, the dialog reopens the one the user had.
   */
  protected async switchCamera(deviceId: string): Promise<void> {
    const previous = this.cameraId();

    if (!deviceId || deviceId === previous || this.switching()) {
      return;
    }

    this.switching.set(true);
    this.notice.set('');
    this.stop();

    try {
      await this.start(deviceId, false);
      rememberCamera(deviceId);
    } catch {
      this.notice.set('That camera did not open. The camera you had is back.');
      await this.start(previous).catch(() => undefined);
    } finally {
      this.switching.set(false);
    }
  }

  /**
   * Open the camera. With no device id, use the camera from the last visit. With
   * `fallback` false, a camera that does not open throws, for the switch to handle.
   */
  private async start(deviceId?: string, fallback = true): Promise<void> {
    this.error.set('');
    this.ready.set(false);

    if (!hasLiveCamera()) {
      this.error.set('This browser cannot show a live camera.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await openCamera(deviceId, fallback);
    } catch (error) {
      if (!fallback) {
        throw error;
      }
      this.error.set(
        'The camera did not open. Allow the camera for this site, or use the one-photo camera.',
      );
      return;
    }

    // The user can close the dialog while the browser asks for the camera.
    if (!this.open()) {
      closeCamera(stream);
      return;
    }

    this.stream = stream;
    this.cameraId.set(cameraIdOf(stream));
    await prepareCamera(stream);
    this.cameras.set(await listCameras());

    const video = this.video()?.nativeElement;
    if (video) {
      video.srcObject = stream;
      try {
        await video.play();
        this.ready.set(true);
      } catch {
        this.error.set('The camera did not start. Close this dialog and try again.');
      }
    }
  }

  private stop(): void {
    closeCamera(this.stream);
    this.stream = null;
    this.ready.set(false);

    const video = this.video()?.nativeElement;
    if (video) {
      video.srcObject = null;
    }
  }

  private clear(): void {
    for (const shot of this.shots()) {
      URL.revokeObjectURL(shot.url);
    }
    this.shots.set([]);
  }
}
