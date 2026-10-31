import { Component, computed, inject, input, signal } from '@angular/core';
import { ImageStore } from '../core/image-store';
import { PhotoViewer } from '../photo-viewer/photo-viewer';
import { CameraDialog } from '../camera-dialog/camera-dialog';

/**
 * The photo strip of one article in edit mode. A tap on a photo opens the full-screen
 * carousel on that photo.
 *
 * Add photo wraps a hidden file input, and takes several files at once. Camera opens the
 * camera dialog, which takes several photos in one go.
 *
 * `NgOptimizedImage` cannot serve these photos. They are blob URLs out of IndexedDB, not
 * static assets, so the strip uses a plain `<img>` with an explicit size.
 */
@Component({
  selector: 'app-article-photos',
  imports: [PhotoViewer, CameraDialog],
  template: `
    <div class="flex flex-wrap items-center gap-2">
      @for (photo of photos(); track photo.id) {
        <button
          type="button"
          class="h-16 w-16 overflow-hidden rounded-lg border border-stone-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 dark:border-stone-700 dark:focus-visible:outline-amber-400"
          [attr.aria-label]="'Open photo ' + ($index + 1) + ' of ' + label()"
          (click)="viewing.set($index)"
        >
          <img
            class="h-full w-full object-cover"
            [src]="images.urlFor(photo)"
            [width]="photo.width"
            [height]="photo.height"
            [alt]="'Photo ' + ($index + 1) + ' of ' + label()"
            loading="lazy"
            decoding="async"
          />
        </button>
      }

      <label class="btn-quiet cursor-pointer">
        <span>Add photo</span>
        <input
          class="sr-only"
          type="file"
          accept="image/*"
          multiple
          [attr.aria-label]="'Add a photo of ' + label()"
          (change)="pick($event)"
        />
      </label>

      <button
        type="button"
        class="btn-quiet"
        aria-haspopup="dialog"
        [attr.aria-label]="'Take photos of ' + label()"
        (click)="cameraOpen.set(true)"
      >
        Camera
      </button>
    </div>

    @if (images.working() > 0) {
      <p class="muted mt-2 text-xs" role="status">Saving {{ images.working() }} photo(s)…</p>
    }
    @if (failed()) {
      <p class="mt-2 text-xs text-rose-700 dark:text-rose-400" role="alert">{{ failed() }}</p>
    }

    <app-camera-dialog
      [open]="cameraOpen()"
      [label]="label()"
      (saved)="save($event)"
      (closed)="cameraOpen.set(false)"
    />

    <app-photo-viewer
      [photos]="photos()"
      [start]="viewing()"
      [articleName]="label()"
      (closed)="viewing.set(null)"
    />
  `,
})
export class ArticlePhotos {
  readonly articleId = input.required<string>();
  readonly articleName = input('');

  protected readonly images = inject(ImageStore);
  /** The index of the photo the viewer opened on, or null when it is closed. */
  protected readonly viewing = signal<number | null>(null);
  protected readonly failed = signal('');
  protected readonly cameraOpen = signal(false);
  protected readonly label = computed(() => this.articleName().trim() || 'this article');

  private readonly list = computed(() => this.images.imagesFor(this.articleId()));
  protected readonly photos = computed(() => this.list()());

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    void this.save(files);
  }

  protected async save(files: readonly File[]): Promise<void> {
    this.failed.set('');

    try {
      await this.images.add(this.articleId(), files);
    } catch {
      this.failed.set('The photo did not save. The storage may be full.');
    }
  }
}
