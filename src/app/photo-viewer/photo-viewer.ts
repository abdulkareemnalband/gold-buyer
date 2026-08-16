import { Component, effect, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { ImageStore } from '../core/image-store';
import { ArticleImage } from '../core/models';

/** One photo at full width, with a delete button. */
@Component({
  selector: 'app-photo-viewer',
  template: `
    <dialog
      #viewer
      class="sheet sm:max-w-3xl"
      aria-labelledby="viewer-title"
      (close)="closed.emit()"
    >
      <h2 id="viewer-title" class="mb-3 text-lg font-semibold">
        Photo of {{ articleName() || 'the article' }}
      </h2>

      @if (image(); as photo) {
        <img
          class="mx-auto h-auto max-h-[70dvh] w-auto max-w-full rounded-lg"
          [src]="images.urlFor(photo)"
          [width]="photo.width"
          [height]="photo.height"
          [alt]="'Photo of ' + (articleName() || 'the article')"
          decoding="async"
        />
      }

      <div class="mt-4 flex gap-2">
        <button type="button" class="btn-danger flex-1" (click)="remove()">Delete photo</button>
        <button type="button" class="btn-quiet flex-1" (click)="closed.emit()">Close</button>
      </div>
    </dialog>
  `,
})
export class PhotoViewer {
  readonly image = input<ArticleImage | null>(null);
  readonly articleName = input('');
  readonly closed = output<void>();

  protected readonly images = inject(ImageStore);
  private readonly viewer = viewChild.required<ElementRef<HTMLDialogElement>>('viewer');

  constructor() {
    effect(() => {
      const dialog = this.viewer().nativeElement;

      if (this.image()) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }

  protected remove(): void {
    const photo = this.image();

    if (photo) {
      void this.images.remove(photo);
    }

    this.closed.emit();
  }
}
