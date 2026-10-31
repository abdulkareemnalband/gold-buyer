import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { barcodeTypeName, BarcodeReader } from '../core/barcode-reader';
import { Barcode } from '../core/models';

/**
 * A barcode drawn from its data, in its own type. The app never keeps the photo of the
 * tag.
 *
 * The drawing is an SVG data URL, so `NgOptimizedImage` cannot serve it. The image sits
 * on white in both colour schemes, because a scanner needs dark bars on a light ground.
 */
@Component({
  selector: 'app-barcode-image',
  host: { class: 'block', '[class.text-center]': 'large()' },
  template: `
    @if (url(); as src) {
      <figure
        class="inline-block max-w-full rounded-lg border border-stone-300 bg-white p-1 dark:border-stone-700"
        [class.w-full]="large()"
        [class.max-w-40]="large()"
      >
        <img
          class="block h-auto max-w-full"
          [class]="large() ? 'max-h-28 w-full object-contain' : 'max-h-24 w-auto'"
          [src]="src"
          [alt]="typeName() + ' of ' + label() + ': ' + barcode().data"
          decoding="async"
        />
        @if (caption()) {
          <figcaption class="px-1 pt-1 text-center text-xs break-all text-stone-700 tabular-nums">
            {{ typeName() }} · {{ barcode().data }}
          </figcaption>
        }
      </figure>
    } @else if (failed()) {
      <p class="text-xs break-all text-rose-700 dark:text-rose-400">
        {{ barcode().data }} does not fit the {{ typeName() }} format.
      </p>
    }
  `,
})
export class BarcodeImage {
  readonly barcode = input.required<Barcode>();
  readonly label = input('this article');
  /**
   * False hides the line under the barcode with the format and the value. The image
   * keeps both in its text alternative.
   */
  readonly caption = input(true);
  /** True draws the barcode up to 10rem wide and 7rem tall, centred, for view mode. */
  readonly large = input(false);

  private readonly barcodes = inject(BarcodeReader);
  protected readonly url = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly typeName = computed(() => barcodeTypeName(this.barcode().type));

  /** Counts the draws. A late result from an older barcode must not replace a newer one. */
  private draw = 0;

  constructor() {
    effect(() => {
      const barcode = this.barcode();
      const draw = ++this.draw;

      this.barcodes.render(barcode).then(
        (url) => {
          if (draw === this.draw) {
            this.url.set(url);
            this.failed.set(url === null && barcode.data.trim() !== '');
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
