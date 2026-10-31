import {
  afterNextRender,
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
import { GoldStore } from '../core/gold-store';
import { computeArticle } from '../core/gold-math';
import { ImageStore } from '../core/image-store';
import { Article, METAL_NAMES } from '../core/models';
import { GramsPipe, InrPipe } from '../core/inr-pipe';
import { PhotoViewer } from '../photo-viewer/photo-viewer';
import { formatDay } from '../core/dates';

/**
 * The view mode of one article. It is built for a quick look at the counter: the photos,
 * the price to pay, and the few facts that set that price. It has no input fields except
 * the checkbox that counts the piece in the totals.
 */
@Component({
  selector: 'app-article-view',
  host: { '(document:click)': 'onDocumentClick($event)' },
  imports: [InrPipe, GramsPipe, PhotoViewer],
  template: `
    <article class="card p-3" [attr.aria-labelledby]="'view-title-' + article().id">
      <div class="flex items-start gap-2">
        <input
          class="mt-1 h-6 w-6 shrink-0 accent-amber-700 dark:accent-amber-500"
          type="checkbox"
          [id]="'view-pick-' + article().id"
          [checked]="article().selected"
          (change)="toggle($event)"
        />
        <label class="sr-only" [attr.for]="'view-pick-' + article().id">
          Count {{ name() }} in the totals
        </label>

        <div class="min-w-0 flex-1">
          <h2 class="truncate font-semibold" [id]="'view-title-' + article().id">
            {{ article().name.trim() || 'Unnamed piece' }}
          </h2>
          <p class="muted text-xs">
            {{ purity() }} · {{ article().weightGrams | grams }}
            @if (dates()) {
              · {{ dates() }}
            }
          </p>
        </div>

        <button
          #editButton
          type="button"
          class="btn-quiet shrink-0"
          [attr.aria-label]="'Edit ' + name()"
          (click)="edit.emit()"
        >
          Edit
        </button>

        <!-- The menu of less common actions. It closes on Escape, on a click outside,
             and when the focus leaves it. -->
        <div #menuRoot class="relative shrink-0" (focusout)="onMenuFocusOut($event)">
          <button
            #menuButton
            type="button"
            class="btn-quiet px-3"
            aria-haspopup="menu"
            [attr.aria-expanded]="menuOpen()"
            [attr.aria-controls]="menuOpen() ? 'menu-' + article().id : null"
            [attr.aria-label]="'More actions for ' + name()"
            (click)="menuOpen.set(!menuOpen())"
          >
            <span aria-hidden="true" class="text-lg leading-none">⋮</span>
          </button>

          @if (menuOpen()) {
            <div
              role="menu"
              class="card absolute right-0 z-20 mt-1 min-w-40 p-1"
              [id]="'menu-' + article().id"
              [attr.aria-label]="'Actions for ' + name()"
              (keydown.escape)="closeMenu(true)"
            >
              <button
                #firstMenuItem
                type="button"
                role="menuitem"
                class="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-amber-700 dark:hover:bg-stone-800 dark:focus-visible:outline-amber-400"
                (click)="onDuplicate()"
              >
                Duplicate
              </button>
            </div>
          }
        </div>
      </div>

      @if (photos().length > 0) {
        <!-- Thumbnails only. A tap opens the large carousel on that photo. -->
        <ul class="mt-3 flex flex-wrap gap-2" [attr.aria-label]="'Photos of ' + name()">
          @for (photo of photos(); track photo.id) {
            <li>
              <button
                type="button"
                class="block h-16 w-16 cursor-zoom-in overflow-hidden rounded-lg border border-stone-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 dark:border-stone-700 dark:focus-visible:outline-amber-400"
                [attr.aria-label]="'Open photo ' + ($index + 1) + ' of ' + name()"
                (click)="viewing.set($index)"
              >
                <img
                  class="h-full w-full object-cover"
                  [src]="images.urlFor(photo)"
                  [width]="photo.width"
                  [height]="photo.height"
                  [alt]="'Photo ' + ($index + 1) + ' of ' + name()"
                  loading="lazy"
                  decoding="async"
                />
              </button>
            </li>
          }
        </ul>
        <app-photo-viewer
          [photos]="photos()"
          [start]="viewing()"
          [articleName]="article().name"
          (closed)="viewing.set(null)"
        />
      }

      <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums">
        <dt class="muted">
          {{ metalName() }} value
          <span class="block text-xs">
            at {{ price().valueRate.perGram | inr: 'exact' }}/g{{ onDay(price().valueRate.date) }}
          </span>
        </dt>
        <dd class="text-right">{{ price().metalPrice | inr }}</dd>

        <dt class="muted">
          Making charge, {{ article().makingChargePercent }}%
          <span class="block text-xs">
            of {{ price().purchaseRate.perGram | inr: 'exact' }}/g{{
              onDay(price().purchaseRate.date)
            }}
          </span>
        </dt>
        <dd class="text-right">{{ price().grossMakingCharge | inr }}</dd>

        @if (price().makingDiscount > 0) {
          <dt class="muted">Discount on making, {{ article().makingDiscountPercent }}%</dt>
          <dd class="text-right">−{{ price().makingDiscount | inr }}</dd>

          <dt class="muted">Making charge after discount, {{ netMakingPercent() }}%</dt>
          <dd class="text-right">{{ price().makingCharge | inr }}</dd>
        }

        @if (article().stones.length > 0) {
          <dt class="muted">
            {{ article().stones.length }} {{ article().stones.length === 1 ? 'stone' : 'stones' }}
          </dt>
          <dd class="text-right">{{ price().stonePrice | inr }}</dd>
        }

        <dt class="muted">Tax</dt>
        <dd class="text-right">{{ price().tax | inr }}</dd>

        <dt class="font-medium">Price after tax</dt>
        <dd class="text-right text-lg font-semibold text-amber-800 dark:text-amber-300">
          {{ price().priceAfterTax | inr }}
        </dd>
      </dl>

      @if (article().notes.trim()) {
        <p class="muted mt-2 text-sm whitespace-pre-line">{{ article().notes }}</p>
      }
    </article>
  `,
})
export class ArticleView {
  readonly article = input.required<Article>();
  /** True when the user just left edit mode. The focus returns to the Edit button. */
  readonly focusOnInit = input(false);
  readonly edit = output<void>();
  /** The user picked Duplicate in the menu. The shell makes the copy and opens it. */
  readonly duplicate = output<void>();

  private readonly store = inject(GoldStore);
  protected readonly images = inject(ImageStore);
  private readonly editButton = viewChild.required<ElementRef<HTMLButtonElement>>('editButton');
  private readonly menuRoot = viewChild.required<ElementRef<HTMLElement>>('menuRoot');
  private readonly menuButton = viewChild.required<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly firstMenuItem = viewChild<ElementRef<HTMLButtonElement>>('firstMenuItem');

  protected readonly menuOpen = signal(false);

  private readonly list = computed(() => this.images.imagesFor(this.article().id));
  protected readonly photos = computed(() => this.list()());

  protected readonly price = computed(() => computeArticle(this.article(), this.store.pricing()));
  /** The photo the large carousel opened on, or null when it is closed. */
  protected readonly viewing = signal<number | null>(null);

  /** The booking and purchase dates of a gold piece, for the line under the name. */
  protected readonly dates = computed(() => {
    const article = this.article();
    if (article.metal !== 'gold') {
      return '';
    }
    const parts: string[] = [];
    if (article.bookingDate) {
      parts.push(`booked ${formatDay(article.bookingDate)}`);
    }
    if (article.purchaseDate) {
      parts.push(`bought ${formatDay(article.purchaseDate)}`);
    }
    return parts.join(' · ');
  });

  /**
   * The making percentage after the discount, such as 9 for 12% less 25%. It rounds to
   * 2 decimal places for the label.
   */
  protected readonly netMakingPercent = computed(() => {
    const article = this.article();
    const discount = Math.min(100, Math.max(0, article.makingDiscountPercent));
    const percent = article.makingChargePercent * (1 - discount / 100);
    return Math.round(percent * 100) / 100;
  });

  protected readonly name = computed(() => this.article().name.trim() || 'this article');
  protected readonly metalName = computed(() => METAL_NAMES[this.article().metal]);
  protected readonly purity = computed(() => {
    const article = this.article();
    return article.metal === 'gold' ? `Gold ${article.karat}kt` : METAL_NAMES[article.metal];
  });

  constructor() {
    // Move the focus into the menu when it opens.
    effect(() => this.firstMenuItem()?.nativeElement.focus());

    afterNextRender(() => {
      if (this.focusOnInit()) {
        this.editButton().nativeElement.focus();
      }
    });
  }

  /** The day of a gold rate for a rate line, such as ", 31 Oct 2026". */
  protected onDay(date: string): string {
    return date ? `, ${formatDay(date)}` : '';
  }

  protected closeMenu(returnFocus: boolean): void {
    this.menuOpen.set(false);
    if (returnFocus) {
      this.menuButton().nativeElement.focus();
    }
  }

  protected onMenuFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !this.menuRoot().nativeElement.contains(next)) {
      this.menuOpen.set(false);
    }
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.menuOpen() && !this.menuRoot().nativeElement.contains(event.target as Node)) {
      this.menuOpen.set(false);
    }
  }

  protected onDuplicate(): void {
    this.menuOpen.set(false);
    this.duplicate.emit();
  }

  protected toggle(event: Event): void {
    const selected = (event.target as HTMLInputElement).checked;
    this.store.patchArticle(this.article().id, { selected });
  }
}
