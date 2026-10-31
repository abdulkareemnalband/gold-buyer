import {
  Component,
  computed,
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
import { Area, BarcodeReader, guideArea, NO_BARCODE } from '../core/barcode-reader';
import {
  CameraControls,
  CameraInfo,
  cameraIdOf,
  closeCamera,
  hasLiveCamera,
  listCameras,
  openCamera,
  prepareCamera,
  rememberCamera,
  setTorch,
  setZoom,
} from '../core/camera';
import { Barcode } from '../core/models';
import { CameraPicker } from '../camera-picker/camera-picker';

/** The wait between two read attempts, in milliseconds. */
const READ_EVERY_MS = 250;
/** The longest side of the area each attempt reads. Smaller reads faster on a phone. */
const LIVE_READ_SIZE = 1000;
/** Every this many attempts, read the whole frame, for a code outside the guide box. */
const FULL_FRAME_EVERY = 4;
/** A close tag is often blurred. A little zoom lets the user hold the phone back. */
const START_ZOOM = 2;

const FULL_AREA: Area = { x: 0, y: 0, width: 1, height: 1 };

/**
 * A live barcode scan.
 *
 * A camera cannot focus closer than its minimum distance, so one photo of a small tag is
 * often blurred. This dialog reads the live camera several times each second, and the
 * first sharp frame wins. The user moves the phone until it reads. Zoom, where the camera
 * has it, lets the user hold the phone back, at a distance where it can focus.
 *
 * The reader looks inside the guide box first, so a price tag or another code beside the
 * barcode does not get in the way. Every few frames it also reads the whole frame.
 */
@Component({
  selector: 'app-scan-dialog',
  imports: [CameraPicker],
  template: `
    <dialog
      #dialog
      class="sheet max-h-[95dvh] overflow-y-auto sm:max-w-2xl"
      aria-labelledby="scan-title"
      (close)="onDialogClose()"
    >
      <h2 id="scan-title" class="mb-3 text-lg font-semibold">Scan the barcode of {{ label() }}</h2>

      @if (error()) {
        <p class="mb-3 text-sm text-rose-700 dark:text-rose-400" role="alert">{{ error() }}</p>
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

        <!-- The box has the shape of the video, so the guide box sits on the same pixels
             that the reader reads. -->
        <div
          class="relative mx-auto w-full overflow-hidden rounded-lg bg-black"
          [style.aspect-ratio]="aspect()"
          [style.max-width]="'calc(55dvh * ' + aspect() + ')'"
        >
          <video
            #video
            class="block h-full w-full"
            playsinline
            muted
            aria-hidden="true"
            (loadedmetadata)="onMetadata()"
          ></video>
          <div
            class="pointer-events-none absolute rounded-md border-2 border-amber-400 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]"
            aria-hidden="true"
            [style.left.%]="guide().x * 100"
            [style.top.%]="guide().y * 100"
            [style.width.%]="guide().width * 100"
            [style.height.%]="guide().height * 100"
          ></div>
        </div>

        <p class="muted mt-2 text-sm">
          Put the barcode inside the box. Move the phone back until the picture is sharp.
          @if (controls().zoom) {
            Zoom makes a small tag larger.
          }
        </p>

        @if (controls().zoom; as zoom) {
          <div class="mt-2">
            <label class="label" for="scan-zoom">Zoom {{ zoomLevel().toFixed(1) }}×</label>
            <input
              id="scan-zoom"
              class="w-full accent-amber-700 dark:accent-amber-500"
              type="range"
              [min]="zoom.min"
              [max]="zoom.max"
              [step]="zoom.step"
              [value]="zoomLevel()"
              (input)="changeZoom($any($event.target).valueAsNumber)"
            />
          </div>
        }

        @if (controls().torch) {
          <button
            type="button"
            class="btn-quiet mt-2"
            [attr.aria-pressed]="torchOn()"
            (click)="toggleTorch()"
          >
            Light
          </button>
        }
      }

      <p class="muted mt-3 text-sm" role="status" aria-live="polite">{{ status() }}</p>

      <div class="mt-4 flex flex-wrap gap-2">
        <!-- A photo still works when the live camera does not, or for a tag far away. -->
        <label class="btn-quiet cursor-pointer">
          <span>Use a photo</span>
          <input
            class="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            (change)="readPhoto($event)"
          />
        </label>
        <button type="button" class="btn-quiet ml-auto" (click)="finish()">Cancel</button>
      </div>
    </dialog>
  `,
})
export class ScanDialog {
  readonly open = input.required<boolean>();
  readonly label = input('this article');
  /** The barcode the camera read. The dialog closes after it. */
  readonly scanned = output<Barcode>();
  readonly closed = output<void>();

  private readonly reader = inject(BarcodeReader);

  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly status = signal('');
  protected readonly cameras = signal<CameraInfo[]>([]);
  protected readonly cameraId = signal('');
  protected readonly switching = signal(false);
  protected readonly controls = signal<CameraControls>({ torch: false });
  protected readonly zoomLevel = signal(1);
  protected readonly torchOn = signal(false);
  /** The width and the height of the video frame. */
  private readonly frame = signal({ width: 3, height: 4 });

  protected readonly aspect = computed(() => `${this.frame().width} / ${this.frame().height}`);
  protected readonly guide = computed(() => guideArea(this.frame().width, this.frame().height));

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;

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

    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected onMetadata(): void {
    const video = this.video()?.nativeElement;

    if (video?.videoWidth) {
      this.frame.set({ width: video.videoWidth, height: video.videoHeight });
    }
  }

  protected async changeZoom(zoom: number): Promise<void> {
    if (Number.isFinite(zoom)) {
      this.zoomLevel.set(zoom);
      await setZoom(this.stream, zoom);
    }
  }

  protected async toggleTorch(): Promise<void> {
    const on = !this.torchOn();
    this.torchOn.set(on);
    await setTorch(this.stream, on);
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

  /** A photo from the phone camera. The reader looks in its middle first. */
  protected async readPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const photo = input.files?.[0];
    input.value = '';

    if (!photo) {
      return;
    }

    this.status.set('Reading the photo…');
    try {
      const barcode = await this.reader.read(photo);
      if (barcode) {
        this.found(barcode);
      } else {
        this.status.set(NO_BARCODE);
      }
    } catch {
      this.status.set(NO_BARCODE);
    }
  }

  protected finish(): void {
    this.stop();
    this.closed.emit();
  }

  /** Escape closes the dialog without a tap on Cancel. Treat it as a cancel. */
  protected onDialogClose(): void {
    this.stop();
    this.closed.emit();
  }

  private found(barcode: Barcode): void {
    navigator.vibrate?.(80);
    this.scanned.emit(barcode);
    this.finish();
  }

  /**
   * Open the camera and start the read loop. With `fallback` false, a camera that does
   * not open throws, for the switch to handle.
   */
  private async start(deviceId?: string, fallback = true): Promise<void> {
    this.error.set('');
    this.status.set('Opening the camera…');

    if (!hasLiveCamera()) {
      this.error.set('This browser cannot show a live camera. Use a photo of the tag.');
      this.status.set('');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await openCamera(deviceId, fallback);
    } catch (error) {
      if (!fallback) {
        throw error;
      }
      this.error.set('The camera did not open. Allow the camera for this site, or use a photo.');
      this.status.set('');
      return;
    }

    // The user can close the dialog while the browser asks for the camera.
    if (!this.open()) {
      closeCamera(stream);
      return;
    }

    this.stream = stream;
    this.cameraId.set(cameraIdOf(stream));
    const controls = await prepareCamera(stream);
    this.controls.set(controls);
    this.cameras.set(await listCameras());

    if (controls.zoom) {
      const zoom = Math.min(controls.zoom.max, Math.max(controls.zoom.min, START_ZOOM));
      await this.changeZoom(zoom);
    }

    const video = this.video()?.nativeElement;
    if (!video) {
      return;
    }

    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      this.error.set('The camera did not start. Close this dialog and try again.');
      this.status.set('');
      return;
    }

    this.status.set('Looking for a barcode…');
    this.attempt = 0;
    this.loop();
  }

  /** Read one frame, then wait and read the next, until a code is found or the dialog closes. */
  private loop(): void {
    this.timer = setTimeout(async () => {
      const video = this.video()?.nativeElement;

      if (!this.stream || !video || video.videoWidth === 0) {
        if (this.stream) {
          this.loop();
        }
        return;
      }

      const whole = ++this.attempt % FULL_FRAME_EVERY === 0;
      const area = whole ? FULL_AREA : this.guide();

      try {
        const barcode = await this.reader.readArea(
          video,
          video.videoWidth,
          video.videoHeight,
          area,
          LIVE_READ_SIZE,
        );
        if (barcode && this.stream) {
          this.found(barcode);
          return;
        }
      } catch {
        // A frame that fails to read is like a frame with no code.
      }

      if (this.stream) {
        this.loop();
      }
    }, READ_EVERY_MS);
  }

  private stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;

    if (this.torchOn()) {
      void setTorch(this.stream, false);
      this.torchOn.set(false);
    }
    closeCamera(this.stream);
    this.stream = null;

    const video = this.video()?.nativeElement;
    if (video) {
      video.srcObject = null;
    }
  }
}
