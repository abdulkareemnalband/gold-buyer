import {
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { applyEach, form, FormField, max, min, schema } from '@angular/forms/signals';
import { GoldStore, ShopDetails } from '../core/gold-store';
import { latestGoldRate, rate24, ratePerGram } from '../core/gold-math';
import { isoDay } from '../core/dates';
import {
  GoldRate,
  KARATS,
  MAX_KARAT,
  StoneRate,
  StoneUnit,
  STONE_UNITS,
  UNIT_NAMES,
} from '../core/models';

/** Add a new shop, or edit the details of the active shop. */
export type ShopDialogMode = 'add' | 'edit';

interface ShopForm {
  title: string;
  /** The dated gold rates. Each one keeps the karat the user typed it in. */
  goldRates: GoldRate[];
  silverPricePerGram: number;
  platinumPricePerGram: number;
  stoneRates: StoneRate[];
}

const BLANK: ShopForm = {
  title: '',
  goldRates: [],
  silverPricePerGram: 0,
  platinumPricePerGram: 0,
  stoneRates: [],
};

const shopSchema = schema<ShopForm>((shop) => {
  min(shop.silverPricePerGram, 0);
  min(shop.platinumPricePerGram, 0);
  applyEach(shop.goldRates, (rate) => {
    min(rate.karat, 1);
    max(rate.karat, MAX_KARAT);
    min(rate.rate, 0);
  });
});

/**
 * The one place for the details of a shop: its name, its dated gold rates, the silver
 * and platinum rates, and its stone rates.
 *
 * In `add` mode the dialog keeps every value to itself until the user taps Add shop. On
 * start with no shop at all, `required` is true. The dialog then has no cancel button
 * and ignores the Escape key, because the app needs a shop to work.
 *
 * In `edit` mode every change goes to the active shop at once, like every other field
 * in the app. The dialog is modal, so nothing else changes the shop while it is open.
 */
@Component({
  selector: 'app-shop-dialog',
  imports: [FormField],
  template: `
    <dialog
      #dialog
      class="sheet max-h-[90dvh] overflow-y-auto"
      aria-labelledby="shop-dialog-title"
      (cancel)="onCancel($event)"
      (close)="closed.emit()"
    >
      <form (submit)="submit($event)">
        <h2 id="shop-dialog-title" class="mb-1 text-lg font-semibold">{{ heading() }}</h2>
        <p class="muted mb-3 text-sm">Each shop keeps its own rates and its own jewellery.</p>

        <label class="label" for="shop-title">Shop name</label>
        <input
          #titleField
          id="shop-title"
          class="input"
          type="text"
          autocomplete="off"
          [placeholder]="mode() === 'add' ? store.suggestedTitle() : ''"
          [formField]="f.title"
        />

        <section class="mt-4" aria-labelledby="gold-rates-title">
          <h3 id="gold-rates-title" class="text-sm font-semibold">Gold rates</h3>
          <p class="muted mt-1 text-xs">
            Add one rate for each day. Type it in any karat. The latest date is the rate of today. A
            piece with a booking or purchase date uses the rate of that day.
          </p>

          @for (rate of f.goldRates; track model().goldRates[$index].id; let index = $index) {
            <div class="mt-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
              <div class="flex items-end gap-2">
                <div class="flex-1">
                  <label class="label" [attr.for]="'gold-date-' + index">Date</label>
                  <input
                    class="input"
                    type="date"
                    [id]="'gold-date-' + index"
                    [formField]="rate.date"
                  />
                </div>
                <button
                  type="button"
                  class="btn-danger shrink-0"
                  [attr.aria-label]="
                    'Remove the gold rate of ' + (model().goldRates[index].date || 'no date')
                  "
                  (click)="removeGoldRate(index)"
                >
                  Remove
                </button>
              </div>

              <div class="mt-2 flex flex-wrap items-end gap-2">
                <div class="w-20">
                  <label class="label" [attr.for]="'gold-karat-' + index">Karat</label>
                  <input
                    class="input"
                    type="number"
                    inputmode="decimal"
                    step="0.5"
                    [id]="'gold-karat-' + index"
                    [formField]="rate.karat"
                  />
                </div>
                <div
                  class="segment"
                  role="group"
                  [attr.aria-label]="'Common karats for rate ' + (index + 1)"
                >
                  @for (karat of karats; track karat) {
                    <button
                      type="button"
                      class="segment-button min-w-11"
                      [attr.aria-pressed]="model().goldRates[index].karat === karat"
                      (click)="setGoldKarat(index, karat)"
                    >
                      {{ karat }}
                    </button>
                  }
                </div>
                <div class="min-w-28 flex-1">
                  <label class="label" [attr.for]="'gold-rate-' + index">
                    Rate per gram, {{ model().goldRates[index].karat }}kt
                  </label>
                  <input
                    class="input"
                    type="number"
                    inputmode="decimal"
                    step="1"
                    placeholder="0"
                    [id]="'gold-rate-' + index"
                    [formField]="rate.rate"
                  />
                </div>
              </div>

              @if (f.goldRates[index].karat().errors().length > 0) {
                <p class="mt-1 text-xs text-rose-700 dark:text-rose-400" role="alert">
                  A karat runs from 1 to 24.
                </p>
              }
            </div>
          } @empty {
            <p class="muted mt-2 text-xs">No gold rates yet.</p>
          }

          <button type="button" class="btn-quiet mt-2" (click)="addGoldRate()">
            Add a gold rate
          </button>
        </section>

        <h3 class="mt-4 text-sm font-semibold">Other metals</h3>
        <div class="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="shop-silver">Silver, per gram</label>
            <input
              id="shop-silver"
              class="input"
              type="number"
              inputmode="decimal"
              step="0.01"
              placeholder="0"
              [formField]="f.silverPricePerGram"
            />
          </div>
          <div>
            <label class="label" for="shop-platinum">Platinum, per gram</label>
            <input
              id="shop-platinum"
              class="input"
              type="number"
              inputmode="decimal"
              step="1"
              placeholder="0"
              [formField]="f.platinumPricePerGram"
            />
          </div>
        </div>

        <section class="mt-4" aria-labelledby="stone-rates-title">
          <h3 id="stone-rates-title" class="text-sm font-semibold">Stone rates</h3>
          <p class="muted mt-1 text-xs">A stone on a piece can use one of these rates.</p>

          @for (rate of f.stoneRates; track model().stoneRates[$index].id; let index = $index) {
            <div class="mt-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
              <div class="flex items-end gap-2">
                <div class="flex-1">
                  <label class="label" [attr.for]="'rate-kind-' + index">Kind</label>
                  <input
                    class="input"
                    type="text"
                    placeholder="Diamond"
                    [id]="'rate-kind-' + index"
                    [formField]="rate.kind"
                  />
                </div>
                <button
                  type="button"
                  class="btn-danger shrink-0"
                  [attr.aria-label]="'Remove the rate for ' + kindName(index)"
                  (click)="removeStoneRate(index)"
                >
                  Remove
                </button>
              </div>

              <div class="mt-2 flex flex-wrap items-end gap-2">
                <div class="min-w-32 flex-1">
                  <label class="label" [attr.for]="'rate-value-' + index">
                    Rate, {{ unitNames[model().stoneRates[index].unit] }}
                  </label>
                  <input
                    class="input"
                    type="number"
                    inputmode="decimal"
                    step="1"
                    placeholder="0"
                    [id]="'rate-value-' + index"
                    [formField]="rate.rate"
                  />
                </div>
                <div class="segment" role="group" [attr.aria-label]="'Unit for ' + kindName(index)">
                  @for (unit of units; track unit) {
                    <button
                      type="button"
                      class="segment-button"
                      [attr.aria-pressed]="model().stoneRates[index].unit === unit"
                      [attr.aria-label]="unit + ', ' + unitNames[unit]"
                      (click)="setStoneUnit(index, unit)"
                    >
                      {{ unit }}
                    </button>
                  }
                </div>
              </div>
            </div>
          } @empty {
            <p class="muted mt-2 text-xs">No stone rates yet.</p>
          }

          <button type="button" class="btn-quiet mt-2" (click)="addStoneRate()">
            Add a stone rate
          </button>
        </section>

        <div class="mt-4 flex gap-2">
          <button type="submit" class="btn-primary flex-1">
            {{ mode() === 'add' ? 'Add shop' : 'Done' }}
          </button>
          @if (mode() === 'add' && !required()) {
            <button type="button" class="btn-quiet" (click)="closed.emit()">Cancel</button>
          }
        </div>
      </form>
    </dialog>
  `,
})
export class ShopDialog {
  readonly open = input.required<boolean>();
  readonly mode = input<ShopDialogMode>('add');
  readonly required = input(false);
  readonly closed = output<void>();

  protected readonly store = inject(GoldStore);
  protected readonly karats = KARATS;
  protected readonly units = STONE_UNITS;
  protected readonly unitNames = UNIT_NAMES;

  protected readonly model = signal<ShopForm>(BLANK);
  protected readonly f = form(this.model, shopSchema);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly titleField = viewChild.required<ElementRef<HTMLInputElement>>('titleField');

  /** The model as the last seed set it. The edit sync skips that exact object. */
  private seededModel: ShopForm | undefined;

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;

      if (this.open()) {
        if (!dialog.open) {
          untracked(() => this.seed());
          dialog.showModal();
          this.titleField().nativeElement.focus();
        }
      } else {
        this.seededModel = undefined;
        if (dialog.open) {
          dialog.close();
        }
      }
    });

    // In edit mode, send each change to the active shop. The seed itself is not a change.
    effect(() => {
      const shop = this.model();

      if (!this.seededModel || shop === this.seededModel || untracked(this.mode) !== 'edit') {
        return;
      }

      untracked(() => this.store.updateShop(details(shop)));
    });
  }

  protected heading(): string {
    if (this.mode() === 'edit') {
      return 'Shop details';
    }
    return this.required() ? 'Add your first shop' : 'Add a shop';
  }

  protected onCancel(event: Event): void {
    if (this.required()) {
      event.preventDefault();
    }
  }

  /** Enter in a field also lands here. An empty name takes the suggested name. */
  protected submit(event: Event): void {
    event.preventDefault();

    if (this.mode() === 'add') {
      this.store.addCollection(details(this.model()));
    }
    this.closed.emit();
  }

  /**
   * A new rate is for today, in the karat the rate bar shows. It starts from the latest
   * rate, so a small change on the next day needs only a few keystrokes.
   */
  protected addGoldRate(): void {
    const karat = this.store.displayKarat();
    const latest = latestGoldRate(this.model().goldRates);
    const rate: GoldRate = {
      id: crypto.randomUUID(),
      date: isoDay(),
      karat,
      rate: latest ? round2(ratePerGram(rate24(latest), karat)) : 0,
    };
    this.model.update((current) => ({ ...current, goldRates: [rate, ...current.goldRates] }));
  }

  protected removeGoldRate(index: number): void {
    this.model.update((current) => ({
      ...current,
      goldRates: current.goldRates.filter((_, at) => at !== index),
    }));
  }

  /** A karat change keeps the same gold price, so the typed rate converts. */
  protected setGoldKarat(index: number, karat: number): void {
    this.model.update((current) => ({
      ...current,
      goldRates: current.goldRates.map((rate, at) =>
        at === index && rate.karat !== karat
          ? { ...rate, karat, rate: round2(ratePerGram(rate24(rate), karat)) }
          : rate,
      ),
    }));
  }

  protected kindName(index: number): string {
    return this.model().stoneRates[index]?.kind.trim() || `stone rate ${index + 1}`;
  }

  protected addStoneRate(): void {
    const rate: StoneRate = { id: crypto.randomUUID(), kind: '', unit: 'ct', rate: 0 };
    this.model.update((current) => ({ ...current, stoneRates: [...current.stoneRates, rate] }));
  }

  protected removeStoneRate(index: number): void {
    this.model.update((current) => ({
      ...current,
      stoneRates: current.stoneRates.filter((_, at) => at !== index),
    }));
  }

  protected setStoneUnit(index: number, unit: StoneUnit): void {
    this.model.update((current) => ({
      ...current,
      stoneRates: current.stoneRates.map((rate, at) => (at === index ? { ...rate, unit } : rate)),
    }));
  }

  /**
   * Edit mode starts from the active shop. Add mode starts from the latest gold rate and
   * the other metal rates of the active shop, because a trip is one day. The name and the
   * stone rates belong to one shop, so they start empty.
   */
  private seed(): void {
    const shop = this.store.activeCollection();
    const edit = this.mode() === 'edit';
    const goldRates = shop?.goldRates ?? [];
    const latest = latestGoldRate(goldRates);

    this.seededModel = {
      title: edit ? (shop?.title ?? '') : '',
      goldRates: edit
        ? [...goldRates].sort((a, b) => b.date.localeCompare(a.date))
        : latest
          ? [{ ...latest, id: crypto.randomUUID(), date: isoDay() }]
          : [],
      silverPricePerGram: shop?.silverPricePerGram ?? 0,
      platinumPricePerGram: shop?.platinumPricePerGram ?? 0,
      stoneRates: edit ? (shop?.stoneRates ?? []) : [],
    };
    this.model.set(this.seededModel);
  }
}

/** The store form of the dialog model. A half-typed number counts as zero. */
function details(shop: ShopForm): Partial<ShopDetails> {
  return {
    title: shop.title,
    goldRates: shop.goldRates
      .filter((rate) => rate.date)
      .map((rate) => ({ ...rate, karat: num(rate.karat) || 24, rate: num(rate.rate) })),
    silverPricePerGram: num(shop.silverPricePerGram),
    platinumPricePerGram: num(shop.platinumPricePerGram),
    stoneRates: shop.stoneRates.map((rate) => ({ ...rate, rate: num(rate.rate) })),
  };
}

function num(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}
