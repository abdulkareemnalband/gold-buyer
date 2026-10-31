import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ImageStore } from '../core/image-store';
import { ArticleImage } from '../core/models';

/**
 * All photos of one article in one strip. The user swipes, taps the arrows, or presses
 * the arrow keys to move between them.
 *
 * The strip is a horizontal scroll area with CSS scroll snap, so a swipe needs no script.
 * The script only keeps `index` in step with the scroll position.
 *
 * `NgOptimizedImage` cannot serve these photos. They are blob URLs out of IndexedDB, not
 * static assets, so the strip uses a plain `<img>` with an explicit size.
 */
@Component({
  selector: 'app-photo-carousel',
  imports: [NgTemplateOutlet],
  host: { class: 'block' },
  template: `
    <div role="region" aria-roledescription="carousel" [attr.aria-label]="'Photos of ' + label()">
      <div
        #strip
        class="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-lg bg-stone-100 [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 dark:bg-stone-950 dark:focus-visible:outline-amber-400"
        tabindex="0"
        role="group"
        [attr.aria-label]="
          'Photo ' + (current() + 1) + ' of ' + photos().length + '. Use the arrow keys to move.'
        "
        (scroll)="onScroll()"
        (keydown.arrowleft)="go(-1, $event)"
        (keydown.arrowright)="go(1, $event)"
      >
        @for (photo of photos(); track photo.id) {
          <div
            class="flex w-full shrink-0 snap-center items-center justify-center"
            role="group"
            aria-roledescription="slide"
            [attr.aria-label]="$index + 1 + ' of ' + photos().length"
            [class]="tall() ? 'h-[65dvh]' : 'h-56'"
          >
            @if (openable()) {
              <button
                type="button"
                class="h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-700 dark:focus-visible:outline-amber-400"
                [attr.aria-label]="'Open photo ' + ($index + 1) + ' of ' + label() + ' large'"
                (click)="opened.emit($index)"
              >
                <ng-container
                  *ngTemplateOutlet="image; context: { $implicit: photo, index: $index }"
                />
              </button>
            } @else {
              <ng-container
                *ngTemplateOutlet="image; context: { $implicit: photo, index: $index }"
              />
            }
          </div>
        }
      </div>

      <ng-template #image let-photo let-index="index">
        <img
          class="h-full w-full object-contain"
          [src]="images.urlFor(photo)"
          [width]="photo.width"
          [height]="photo.height"
          [alt]="'Photo ' + (index + 1) + ' of ' + label()"
          [attr.loading]="index === current() ? 'eager' : 'lazy'"
          decoding="async"
        />
      </ng-template>

      @if (photos().length > 1) {
        <div class="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            class="btn-quiet"
            [disabled]="current() === 0"
            [attr.aria-label]="'Previous photo of ' + label()"
            (click)="go(-1)"
          >
            <span aria-hidden="true">‹</span> Previous
          </button>

          <p class="muted text-sm tabular-nums" aria-live="polite">
            {{ current() + 1 }} / {{ photos().length }}
          </p>

          <button
            type="button"
            class="btn-quiet"
            [disabled]="current() === photos().length - 1"
            [attr.aria-label]="'Next photo of ' + label()"
            (click)="go(1)"
          >
            Next <span aria-hidden="true">›</span>
          </button>
        </div>
      }
    </div>
  `,
})
export class PhotoCarousel {
  readonly photos = input.required<readonly ArticleImage[]>();
  readonly label = input('this article');
  /** True for the full-screen viewer. False for the strip on a card. */
  readonly tall = input(false);
  /** The photo on screen. The parent sets the first one. The strip updates it. */
  readonly index = model(0);
  /** True when a tap on a photo opens it large. The parent then handles `opened`. */
  readonly openable = input(false);
  /** The user tapped a photo. The value is its index. */
  readonly opened = output<number>();

  protected readonly images = inject(ImageStore);
  private readonly strip = viewChild.required<ElementRef<HTMLElement>>('strip');

  /** The index, kept inside the list after a photo goes away. */
  protected readonly current = computed(() =>
    Math.max(0, Math.min(this.index(), this.photos().length - 1)),
  );

  constructor() {
    // Show the start photo without a scroll animation.
    afterNextRender(() => this.scrollTo(this.current(), 'instant'));

    // Keep the model inside the list when the list gets shorter.
    effect(() => {
      const current = this.current();
      if (current !== this.index()) {
        this.index.set(current);
      }
    });
  }

  protected go(step: number, event?: Event): void {
    event?.preventDefault();
    const next = Math.max(0, Math.min(this.current() + step, this.photos().length - 1));
    this.index.set(next);
    this.scrollTo(next, 'smooth');
  }

  protected onScroll(): void {
    const strip = this.strip().nativeElement;

    if (strip.clientWidth > 0) {
      const index = Math.round(strip.scrollLeft / strip.clientWidth);
      if (index !== this.index()) {
        this.index.set(index);
      }
    }
  }

  private scrollTo(index: number, behavior: ScrollBehavior): void {
    const strip = this.strip().nativeElement;
    strip.scrollTo({ left: index * strip.clientWidth, behavior });
  }
}
