import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { form, FormField, max, min, schema } from '@angular/forms/signals';
import { GoldStore, NewArticle } from '../core/gold-store';
import { computeArticle } from '../core/gold-math';
import { KARATS, MAX_KARAT, Metal, METAL_NAMES, METALS } from '../core/models';
import { InrPipe } from '../core/inr-pipe';

const quickSchema = schema<NewArticle>((piece) => {
  min(piece.weightGrams, 0);
  min(piece.karat, 1, { message: 'A karat runs from 1 to 24.' });
  max(piece.karat, MAX_KARAT, { message: 'A karat runs from 1 to 24.' });
});

/**
 * A short form for a new piece, built for a phone at the counter. It asks only for what
 * sets the price: metal, karat, weight, and making charge. The name is optional. Stones,
 * dates, the discount, and the barcode stay in edit mode.
 *
 * The weight field takes the focus, so the number keyboard opens at once. Add and next
 * keeps the metal, the karat, and the making charge, because pieces from one tray often
 * share them.
 */
@Component({
  selector: 'app-quick-add-dialog',
  imports: [FormField, InrPipe],
  template: `
    <dialog
      #dialog
      class="sheet max-h-[95dvh] overflow-y-auto"
      aria-labelledby="quick-add-title"
      (close)="closed.emit()"
    >
      <form (submit)="add($event, false)">
        <h2 id="quick-add-title" class="mb-3 text-lg font-semibold">Add a piece</h2>

        <span class="label" id="quick-metal-label">Metal</span>
        <div class="segment flex w-full" role="group" aria-labelledby="quick-metal-label">
          @for (metal of metals; track metal) {
            <button
              type="button"
              class="segment-button flex-1"
              [attr.aria-pressed]="metal === model().metal"
              (click)="setMetal(metal)"
            >
              {{ metalNames[metal] }}
            </button>
          }
        </div>

        @if (model().metal === 'gold') {
          <div class="mt-3 flex items-end gap-2">
            <div class="segment flex-1" role="group" aria-label="Karat">
              @for (karat of karats; track karat) {
                <button
                  type="button"
                  class="segment-button flex-1"
                  [attr.aria-pressed]="karat === model().karat"
                  (click)="setKarat(karat)"
                >
                  {{ karat }}kt
                </button>
              }
            </div>
            <div class="w-20">
              <label class="label" for="quick-karat">Karat</label>
              <input
                id="quick-karat"
                class="input"
                type="number"
                inputmode="decimal"
                step="0.5"
                [formField]="f.karat"
              />
            </div>
          </div>
          @if (f.karat().errors().length > 0) {
            <p class="mt-1 text-xs text-rose-700 dark:text-rose-400" role="alert">
              A karat runs from 1 to 24.
            </p>
          }
        }

        <div class="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="quick-weight">Weight (g)</label>
            <input
              #weightField
              id="quick-weight"
              class="input text-lg"
              type="number"
              inputmode="decimal"
              step="0.001"
              placeholder="0"
              enterkeyhint="next"
              [formField]="f.weightGrams"
            />
          </div>
          <div>
            <label class="label" for="quick-making">Making charge (%)</label>
            <input
              id="quick-making"
              class="input text-lg"
              type="number"
              inputmode="decimal"
              step="0.1"
              placeholder="0"
              enterkeyhint="next"
              [formField]="f.makingChargePercent"
            />
          </div>
        </div>

        <label class="label mt-3" for="quick-name">Name (optional)</label>
        <input
          id="quick-name"
          class="input"
          type="text"
          autocomplete="off"
          placeholder="Bangle, chain, ring"
          enterkeyhint="done"
          [formField]="f.name"
        />

        <p class="mt-3 flex items-baseline justify-between text-sm tabular-nums" aria-live="polite">
          <span class="muted">Price after tax</span>
          <span class="text-lg font-semibold text-amber-800 dark:text-amber-300">
            {{ price().priceAfterTax | inr }}
          </span>
        </p>
        @if (added() > 0) {
          <p class="muted text-xs" role="status">
            {{ added() }} {{ added() === 1 ? 'piece' : 'pieces' }} added
          </p>
        }

        <div class="sheet-footer">
          <button type="submit" class="btn-primary flex-1">Add</button>
          <button type="button" class="btn-quiet flex-1" (click)="add($event, true)">
            Add &amp; next
          </button>
          <button type="button" class="btn-quiet" (click)="closed.emit()">Close</button>
        </div>
      </form>
    </dialog>
  `,
})
export class QuickAddDialog {
  readonly open = input.required<boolean>();
  readonly closed = output<void>();

  protected readonly store = inject(GoldStore);
  protected readonly metals = METALS;
  protected readonly metalNames = METAL_NAMES;
  protected readonly karats = KARATS;

  /** The model keeps the metal, the karat, and the making charge between pieces. */
  protected readonly model = signal<NewArticle>({
    name: '',
    metal: 'gold',
    karat: 22,
    weightGrams: Number.NaN,
    makingChargePercent: Number.NaN,
  });
  protected readonly f = form(this.model, quickSchema);

  /** How many pieces this dialog added since it opened. */
  protected readonly added = signal(0);

  protected readonly price = computed(() => {
    const piece = this.model();
    return computeArticle(
      {
        metal: piece.metal,
        karat: piece.karat,
        weightGrams: num(piece.weightGrams),
        makingChargePercent: num(piece.makingChargePercent),
        makingDiscountPercent: 0,
        bookingDate: '',
        purchaseDate: '',
        stones: [],
      },
      this.store.pricing(),
    );
  });

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly weightField = viewChild.required<ElementRef<HTMLInputElement>>('weightField');

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;

      if (this.open()) {
        if (!dialog.open) {
          this.added.set(0);
          dialog.showModal();
          this.weightField().nativeElement.focus();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }

  protected setMetal(metal: Metal): void {
    this.model.update((current) => ({ ...current, metal }));
  }

  protected setKarat(karat: number): void {
    this.model.update((current) => ({ ...current, karat }));
  }

  /**
   * Add the piece. With `next`, clear the weight and the name, keep the rest, and move
   * the focus back to the weight. Without it, close the dialog.
   */
  protected add(event: Event, next: boolean): void {
    event.preventDefault();

    if (this.f.karat().errors().length > 0) {
      return;
    }

    const piece = this.model();
    this.store.addArticle({
      ...piece,
      karat: piece.metal === 'gold' ? piece.karat : this.store.displayKarat(),
      weightGrams: num(piece.weightGrams),
      makingChargePercent: num(piece.makingChargePercent),
    });
    this.added.update((count) => count + 1);
    this.model.update((current) => ({ ...current, name: '', weightGrams: Number.NaN }));

    if (next) {
      this.weightField().nativeElement.focus();
    } else {
      this.closed.emit();
    }
  }
}

function num(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
