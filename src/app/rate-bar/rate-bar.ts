import { Component, effect, inject, linkedSignal, untracked } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { GoldStore } from '../core/gold-store';
import { price24From, ratePerGram } from '../core/gold-math';
import { KARATS } from '../core/models';
import { InrPipe } from '../core/inr-pipe';

/**
 * The gold rate of the active collection.
 *
 * The app stores the 24kt rate alone. The toggle picks the karat the field shows, and an
 * edit in that karat lifts back to the 24kt rate.
 */
@Component({
  selector: 'app-rate-bar',
  imports: [FormField, InrPipe],
  template: `
    <div class="flex flex-wrap items-end gap-3">
      <div class="min-w-40 flex-1">
        <label class="label" for="rate-field">
          Rate per gram, {{ store.displayKarat() }}kt
        </label>
        <input
          id="rate-field"
          class="input"
          type="number"
          inputmode="decimal"
          step="1"
          placeholder="0"
          [formField]="rateForm"
        />
      </div>

      <div class="segment" role="group" aria-label="Show the rate in karats">
        @for (karat of karats; track karat) {
          <button
            type="button"
            class="segment-button"
            [attr.aria-pressed]="karat === store.displayKarat()"
            (click)="store.setDisplayKarat(karat)"
          >
            {{ karat }}kt
          </button>
        }
      </div>
    </div>

    <p class="muted mt-2 text-xs tabular-nums">
      @for (karat of karats; track karat) {
        <span class="mr-3 inline-block">
          {{ karat }}kt {{ rateFor(karat) | inr }}/g
        </span>
      }
    </p>
  `,
})
export class RateBar {
  protected readonly store = inject(GoldStore);
  protected readonly karats = KARATS;

  /**
   * The field value follows the store. A write moves the store, which recomputes this
   * signal to the same number, so the two settle after one pass.
   */
  protected readonly rateModel = linkedSignal(() => round2(this.store.displayRate()));
  protected readonly rateForm = form(this.rateModel);

  constructor() {
    effect(() => {
      const typed = this.rateModel();

      if (!Number.isFinite(typed)) {
        return;
      }

      untracked(() => {
        const karat = this.store.displayKarat();
        const price24 = round2(price24From(typed, karat));

        if (price24 !== round2(this.store.pricePerGram24())) {
          this.store.setPrice24(price24);
        }
      });
    });
  }

  protected rateFor(karat: (typeof KARATS)[number]): number {
    return ratePerGram(this.store.pricePerGram24(), karat);
  }
}

function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}
