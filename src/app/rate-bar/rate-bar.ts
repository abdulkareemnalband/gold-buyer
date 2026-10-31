import { Component, computed, inject, output } from '@angular/core';
import { GoldStore } from '../core/gold-store';
import { ratePerGram } from '../core/gold-math';
import { formatDay } from '../core/dates';
import { KARATS } from '../core/models';
import { InrPipe } from '../core/inr-pipe';

/**
 * The rates of the active shop, read only. The latest gold rate shows in the karat that
 * the toggle picks. The shop dialog is the one place to change a rate.
 */
@Component({
  selector: 'app-rate-bar',
  imports: [InrPipe],
  template: `
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="label">
          Gold, {{ store.displayKarat() }}kt
          @if (latestDay()) {
            · {{ latestDay() }}
          }
        </p>
        @if (store.latestGoldRate()) {
          <p class="text-xl font-semibold tabular-nums">
            {{ rateFor(store.displayKarat()) | inr }}/g
          </p>
        } @else {
          <p class="muted text-sm">No gold rate yet. Add one in the shop details.</p>
        }
      </div>

      <div class="segment" role="group" aria-label="Show the gold rate in karats">
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

    <div class="mt-2 flex items-start justify-between gap-2">
      <p class="muted text-xs tabular-nums">
        @if (store.latestGoldRate()) {
          @for (karat of karats; track karat) {
            <span class="mr-3 inline-block">{{ karat }}kt {{ rateFor(karat) | inr }}/g</span>
          }
        }
        @if (pricing().silverPricePerGram > 0) {
          <span class="mr-3 inline-block">
            Silver {{ pricing().silverPricePerGram | inr: 'exact' }}/g
          </span>
        }
        @if (pricing().platinumPricePerGram > 0) {
          <span class="mr-3 inline-block">
            Platinum {{ pricing().platinumPricePerGram | inr }}/g
          </span>
        }
        @if (pricing().goldRates.length > 1) {
          <span class="mr-3 inline-block">{{ pricing().goldRates.length }} gold rates</span>
        }
        @if (pricing().stoneRates.length > 0) {
          <span class="mr-3 inline-block">
            {{ pricing().stoneRates.length }}
            {{ pricing().stoneRates.length === 1 ? 'stone rate' : 'stone rates' }}
          </span>
        }
      </p>

      <button
        type="button"
        class="btn-quiet shrink-0"
        aria-haspopup="dialog"
        (click)="editShop.emit()"
      >
        Shop details
      </button>
    </div>
  `,
})
export class RateBar {
  protected readonly store = inject(GoldStore);
  protected readonly karats = KARATS;
  protected readonly pricing = this.store.pricing;
  /** The user wants to edit the rates of the shop. The shell opens the shop dialog. */
  readonly editShop = output<void>();

  protected readonly latestDay = computed(() => formatDay(this.store.latestGoldRate()?.date ?? ''));

  protected rateFor(karat: number): number {
    return ratePerGram(this.store.pricePerGram24(), karat);
  }
}
