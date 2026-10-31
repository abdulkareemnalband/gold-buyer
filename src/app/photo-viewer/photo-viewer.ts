import {
  Component,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import { ImageStore } from '../core/image-store';
import { ArticleImage } from '../core/models';
import { PhotoCarousel } from '../photo-carousel/photo-carousel';

/** Every photo of one article in a full-screen carousel, with a delete button. */
@Component({
  selector: 'app-photo-viewer',
  imports: [PhotoCarousel],
  template: `
    <dialog
      #viewer
      class="sheet sm:max-w-3xl"
      aria-labelledby="viewer-title"
      (close)="closed.emit()"
    >
      <h2 id="viewer-title" class="mb-3 text-lg font-semibold">
        Photos of {{ articleName() || 'the article' }}
      </h2>

      <!-- The carousel starts only once the dialog is open, so it can measure its width. -->
      @if (start() !== null && photos().length > 0) {
        <app-photo-carousel
          [photos]="photos()"
          [label]="articleName() || 'the article'"
          [tall]="true"
          [(index)]="current"
        />
      }

      <div class="mt-4 flex gap-2">
        <button type="button" class="btn-danger flex-1" (click)="remove()">
          Delete this photo
        </button>
        <button type="button" class="btn-quiet flex-1" (click)="closed.emit()">Close</button>
      </div>
    </dialog>
  `,
})
export class PhotoViewer {
  readonly photos = input<readonly ArticleImage[]>([]);
  /** The photo to show first. Null keeps the viewer closed. */
  readonly start = input<number | null>(null);
  readonly articleName = input('');
  readonly closed = output<void>();

  protected readonly images = inject(ImageStore);
  protected readonly current = linkedSignal(() => this.start() ?? 0);
  private readonly viewer = viewChild.required<ElementRef<HTMLDialogElement>>('viewer');

  constructor() {
    effect(() => {
      const dialog = this.viewer().nativeElement;

      if (this.start() !== null && this.photos().length > 0) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }

  /** Delete the photo on screen. The carousel then shows the next one. */
  protected remove(): void {
    const photo = this.photos()[this.current()];

    if (photo) {
      void this.images.remove(photo);
    }
  }
}
