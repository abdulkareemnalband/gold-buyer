import { Component, effect, inject, input, signal } from '@angular/core';
import { BarcodeReader } from '../core/barcode-reader';

/**
 * A barcode drawn from its stored value. The app never keeps the photo of the tag.
 *
 * The drawing is an SVG data URL, so `NgOptimizedImage` cannot serve it. The image sits
 * on white in both colour schemes, because a scanner needs dark bars on a light ground.
 */
@Component({
  selector: 'app-barcode-image',
  host: { class: 'block' },
  template: `
    @if (url(); as src) {
      <figure
        class="inline-block max-w-full rounded-lg border border-stone-300 bg-white p-1 dark:border-stone-700"
      >
        <img
          class="block h-auto max-h-32 w-auto max-w-full"
          [src]="src"
          [alt]="'Barcode of ' + label() + ': ' + value()"
          decoding="async"
        />
        <figcaption class="px-1 pt-1 text-center text-xs break-all text-stone-700 tabular-nums">
          {{ value() }}
        </figcaption>
      </figure>
    } @else if (failed()) {
      <p class="muted text-xs break-all">Barcode {{ value() }}. It cannot be drawn.</p>
    }
  `,
})
export class BarcodeImage {
  readonly value = input.required<string>();
  /** The `bwip-js` symbology. An empty string draws Code 128. */
  readonly format = input('');
  readonly label = input('this article');

  private readonly barcodes = inject(BarcodeReader);
  protected readonly url = signal<string | null>(null);
  protected readonly failed = signal(false);

  /** Counts the draws. A late result from an older value must not replace a newer one. */
  private draw = 0;

  constructor() {
    effect(() => {
      const value = this.value();
      const format = this.format();
      const draw = ++this.draw;

      this.barcodes.render(value, format).then(
        (url) => {
          if (draw === this.draw) {
            this.url.set(url);
            this.failed.set(url === null && value.trim() !== '');
          }
        },
        () => {
          if (draw === this.draw) {
            this.url.set(null);
            this.failed.set(true);
          }
        },
      );
    });
  }
}
