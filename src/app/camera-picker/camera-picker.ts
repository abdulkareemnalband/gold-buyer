import { Component, input, output } from '@angular/core';
import { CameraInfo } from '../core/camera';

/** Gives each picker its own field id, because two camera dialogs can be on one page. */
let nextId = 0;

/**
 * The camera list and the Switch button. A phone shows each back lens as its own camera,
 * such as wide and ultra wide. Switch goes to the next camera in the list, and wraps at
 * the end. The picker shows only when the device has two cameras or more.
 */
@Component({
  selector: 'app-camera-picker',
  template: `
    @if (cameras().length > 1) {
      <div class="mb-3 flex items-end gap-2">
        <div class="min-w-0 flex-1">
          <label class="label" [attr.for]="fieldId">Camera</label>
          <select
            class="input"
            [id]="fieldId"
            [disabled]="busy()"
            (change)="picked.emit($any($event.target).value)"
          >
            @for (camera of cameras(); track camera.id) {
              <option [value]="camera.id" [selected]="camera.id === cameraId()">
                {{ camera.label }}
              </option>
            }
          </select>
        </div>
        <button
          type="button"
          class="btn-quiet shrink-0"
          aria-label="Switch to the next camera"
          [disabled]="busy()"
          (click)="next()"
        >
          Switch
        </button>
      </div>
    }
  `,
})
export class CameraPicker {
  readonly cameras = input.required<readonly CameraInfo[]>();
  /** The device id of the open camera. */
  readonly cameraId = input('');
  /** True while a camera opens. A second switch then waits. */
  readonly busy = input(false);
  readonly picked = output<string>();

  protected readonly fieldId = `camera-pick-${nextId++}`;

  protected next(): void {
    const cameras = this.cameras();
    const at = cameras.findIndex((camera) => camera.id === this.cameraId());
    const next = cameras[(at + 1) % cameras.length];

    if (next) {
      this.picked.emit(next.id);
    }
  }
}
