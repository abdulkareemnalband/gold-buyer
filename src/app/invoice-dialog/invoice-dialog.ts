import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { GoldStore } from '../core/gold-store';
import { computeArticle } from '../core/gold-math';
import { formatDay, isoDay } from '../core/dates';
import { METAL_NAMES } from '../core/models';
import { GramsPipe, InrPipe } from '../core/inr-pipe';

/**
 * The selected jewellery of the active shop as one table, laid out like an invoice. Every
 * figure comes from the same price math as the cards, so the two always agree.
 */
@Component({
  selector: 'app-invoice-dialog',
  imports: [InrPipe, GramsPipe],
  template: `
    <dialog
      #dialog
      class="sheet max-h-[90dvh] overflow-y-auto sm:max-w-4xl"
      aria-labelledby="invoice-title"
      (close)="closed.emit()"
    >
      <div class="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 id="invoice-title" class="text-lg font-semibold">
            {{ store.activeCollection()?.title }}
          </h2>
          <p class="muted text-sm">Invoice for the selected jewellery · {{ today }}</p>
        </div>
        <button type="button" class="btn-quiet shrink-0" (click)="closed.emit()">Close</button>
      </div>

      @if (rows().length === 0) {
        <p class="muted p-6 text-center text-sm">No jewellery is selected.</p>
      } @else {
        <!-- The table can be wider than a phone. Its own box scrolls, and the keyboard can
             reach it, so the page never scrolls sideways. -->
        <div
          class="overflow-x-auto rounded-lg border border-stone-200 focus-visible:outline-2 focus-visible:outline-amber-700 dark:border-stone-800 dark:focus-visible:outline-amber-400"
          role="region"
          aria-labelledby="invoice-title"
          tabindex="0"
        >
          <table class="w-full min-w-[44rem] text-sm tabular-nums">
            <caption class="sr-only">
              Selected jewellery at
              {{
                store.activeCollection()?.title
              }}, with the price of each piece and the total to pay
            </caption>
            <thead
              class="bg-stone-100 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300"
            >
              <tr>
                <th scope="col" class="px-2 py-2 text-left font-medium">#</th>
                <th scope="col" class="px-2 py-2 text-left font-medium">Item</th>
                <th scope="col" class="px-2 py-2 text-right font-medium">Weight</th>
                <th scope="col" class="px-2 py-2 text-right font-medium">Rate/g</th>
                <th scope="col" class="px-2 py-2 text-right font-medium">Metal value</th>
                <th scope="col" class="px-2 py-2 text-right font-medium">Making</th>
                <th scope="col" class="px-2 py-2 text-right font-medium">Stones</th>
                <th scope="col" class="px-2 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id; let index = $index) {
                <tr class="border-t border-stone-200 align-top dark:border-stone-800">
                  <td class="px-2 py-2">{{ index + 1 }}</td>
                  <th scope="row" class="px-2 py-2 text-left font-normal">
                    <span class="font-medium">{{ row.name }}</span>
                    <span class="muted block text-xs">{{ row.purity }}</span>
                  </th>
                  <td class="px-2 py-2 text-right">
                    {{ row.weightGrams | grams }}
                    @if (row.stoneWeightGrams > 0) {
                      <span class="muted block text-xs"
                        >+ {{ row.stoneWeightGrams | grams }} stones</span
                      >
                    }
                  </td>
                  <td class="px-2 py-2 text-right">{{ row.ratePerGram | inr: 'exact' }}</td>
                  <td class="px-2 py-2 text-right">{{ row.metalPrice | inr: 'exact' }}</td>
                  <td class="px-2 py-2 text-right">
                    {{ row.makingCharge | inr: 'exact' }}
                    <span class="muted block text-xs">{{ row.makingPercent }}%</span>
                  </td>
                  <td class="px-2 py-2 text-right">{{ row.stonePrice | inr: 'exact' }}</td>
                  <td class="px-2 py-2 text-right font-medium">
                    {{ row.priceBeforeTax | inr: 'exact' }}
                  </td>
                </tr>
              }
            </tbody>
            <tfoot class="border-t-2 border-stone-300 dark:border-stone-700">
              <tr class="font-medium">
                <th scope="row" colspan="2" class="px-2 py-2 text-left">Total</th>
                <td class="px-2 py-2 text-right">{{ totals().totalWeightGrams | grams }}</td>
                <td class="px-2 py-2"></td>
                <td class="px-2 py-2 text-right">{{ totals().metalPrice | inr: 'exact' }}</td>
                <td class="px-2 py-2 text-right">{{ totals().makingCharge | inr: 'exact' }}</td>
                <td class="px-2 py-2 text-right">{{ totals().stonePrice | inr: 'exact' }}</td>
                <td class="px-2 py-2 text-right">{{ totals().priceBeforeTax | inr: 'exact' }}</td>
              </tr>
              <tr>
                <th scope="row" colspan="7" class="px-2 py-1 text-right font-normal">
                  GST at {{ store.gstPercent() }}%
                </th>
                <td class="px-2 py-1 text-right">{{ totals().tax | inr: 'exact' }}</td>
              </tr>
              <tr class="text-base font-semibold">
                <th scope="row" colspan="7" class="px-2 py-2 text-right">Total to pay</th>
                <td class="px-2 py-2 text-right text-amber-800 dark:text-amber-300">
                  {{ totals().priceAfterTax | inr: 'exact' }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p class="muted mt-2 text-xs">
          Making is the charge after any discount. The total weight includes the stones.
        </p>
      }
    </dialog>
  `,
})
export class InvoiceDialog {
  readonly open = input.required<boolean>();
  readonly closed = output<void>();

  protected readonly store = inject(GoldStore);
  protected readonly today = formatDay(isoDay());
  protected readonly totals = this.store.totals;

  /** One row per selected piece, in the order of the list. */
  protected readonly rows = computed(() => {
    const pricing = this.store.pricing();

    return this.store
      .activeArticles()
      .filter((article) => article.selected)
      .map((article) => {
        const price = computeArticle(article, pricing);
        const net = price.makingBase > 0 ? (price.makingCharge / price.makingBase) * 100 : 0;

        return {
          id: article.id,
          name: article.name.trim() || 'Unnamed piece',
          purity: article.metal === 'gold' ? `Gold ${article.karat}kt` : METAL_NAMES[article.metal],
          weightGrams: article.weightGrams,
          stoneWeightGrams: price.totalWeightGrams - article.weightGrams,
          ratePerGram: price.valueRate.perGram,
          metalPrice: price.metalPrice,
          makingCharge: price.makingCharge,
          makingPercent: Math.round(net * 100) / 100,
          stonePrice: price.stonePrice,
          priceBeforeTax: price.priceBeforeTax,
        };
      });
  });

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;

      if (this.open()) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }
}
