import { Component, computed, inject, input, signal } from '@angular/core';
import { ImageStore } from '../core/image-store';
import { ArticleImage } from '../core/models';
import { PhotoViewer } from '../photo-viewer/photo-viewer';

/**
 * The photo strip of one article.
 *
 * Both buttons wrap a hidden file input. The camera button adds `capture`, which opens
 * the rear camera on a phone. A desktop browser ignores `capture` and opens the file
 * picker, which is the wanted fallback.
 *
 * `NgOptimizedImage` cannot serve these photos. They are blob URLs out of IndexedDB, not
 * static assets, so the strip uses a plain `<img>` with an explicit size.
 */
@Component({
  selector: 'app-article-photos',
  imports: [PhotoViewer],
  template: `
    <div class="flex flex-wrap items-center gap-2">
      @for (photo of photos(); track photo.id) {
        <button
          type="button"
          class="h-16 w-16 overflow-hidden rounded-lg border border-stone-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 dark:border-stone-700 dark:focus-visible:outline-amber-400"
          [attr.aria-label]="'Open photo ' + ($index + 1) + ' of ' + label()"
          (click)="viewing.set(photo)"
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

      <label class="btn-quiet cursor-pointer">
        <span>Camera</span>
        <input
          class="sr-only"
          type="file"
          accept="image/*"
          capture="environment"
          [attr.aria-label]="'Take a photo of ' + label()"
          (change)="pick($event)"
        />
      </label>
    </div>

    @if (images.working() > 0) {
      <p class="muted mt-2 text-xs" role="status">Saving {{ images.working() }} photo(s)…</p>
    }
    @if (failed()) {
      <p class="mt-2 text-xs text-rose-700 dark:text-rose-400" role="alert">{{ failed() }}</p>
    }

    <app-photo-viewer
      [image]="viewing()"
      [articleName]="label()"
      (closed)="viewing.set(null)"
    />
  `,
})
export class ArticlePhotos {
  readonly articleId = input.required<string>();
  readonly articleName = input('');

  protected readonly images = inject(ImageStore);
  protected readonly viewing = signal<ArticleImage | null>(null);
  protected readonly failed = signal('');
  protected readonly label = computed(() => this.articleName().trim() || 'this article');

  private readonly list = computed(() => this.images.imagesFor(this.articleId()));
  protected readonly photos = computed(() => this.list()());

  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    this.failed.set('');

    try {
      await this.images.add(this.articleId(), files);
    } catch {
      this.failed.set('The photo did not save. The storage may be full.');
    }
  }
}
