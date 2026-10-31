import {
  Component,
  computed,
  DestroyRef,
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
import { Barcode, KARATS, MAX_KARAT, Metal, METAL_NAMES, METALS } from '../core/models';
import { InrPipe } from '../core/inr-pipe';
import { ImageStore } from '../core/image-store';
import { BarcodeImage } from '../barcode-image/barcode-image';
import { CameraDialog } from '../camera-dialog/camera-dialog';
import { ScanDialog } from '../scan-dialog/scan-dialog';

/** A photo for the new piece. It saves when the user adds the piece. */
interface Shot {
  id: string;
  file: File;
  url: string;
}

const quickSchema = schema<NewArticle>((piece) => {
  min(piece.weightGrams, 0);
  min(piece.karat, 1, { message: 'A karat runs from 1 to 24.' });
  max(piece.karat, MAX_KARAT, { message: 'A karat runs from 1 to 24.' });
});

/**
 * A short form for a new piece, built for a phone at the counter. It asks only for what
 * sets the price: metal, karat, weight, and making charge. The name is optional. More
 * options adds the piece and opens it in edit mode, which has the stones, the dates, the
 * discount, and the barcode.
 *
 * The ⋮ menu takes photos and scans a barcode before the piece exists. The dialog keeps
 * them until Add or More options, then saves them with the piece. Cancel drops them.
 *
 * The weight field takes the focus, so the number keyboard opens at once. The dialog
 * keeps the last metal, karat, and making charge, because pieces in one shop often share
 * them.
 */
@Component({
  selector: 'app-quick-add-dialog',
  host: { '(document:click)': 'onDocumentClick($event)' },
  imports: [FormField, InrPipe, BarcodeImage, CameraDialog, ScanDialog],
  template: `
    <dialog
      #dialog
      class="sheet max-h-[95dvh] overflow-y-auto"
      aria-labelledby="quick-add-title"
      (close)="onDialogClose()"
    >
      <form (submit)="add($event)">
        <div class="mb-3 flex items-center gap-2">
          <h2 id="quick-add-title" class="flex-1 text-lg font-semibold">Add a piece</h2>

          <!-- Photos and a barcode for the new piece. They save with it on Add. The menu
               closes on Escape, on a click outside, and when the focus leaves it. -->
          <div #menuRoot class="relative shrink-0" (focusout)="onMenuFocusOut($event)">
            <button
              #menuButton
              type="button"
              class="btn-quiet px-3"
              aria-haspopup="menu"
              aria-label="Photos and barcode"
              [attr.aria-expanded]="menuOpen()"
              [attr.aria-controls]="menuOpen() ? 'quick-add-menu' : null"
              (click)="menuOpen.set(!menuOpen())"
            >
              <span aria-hidden="true" class="text-lg leading-none">⋮</span>
            </button>

            @if (menuOpen()) {
              <div
                id="quick-add-menu"
                role="menu"
                class="card absolute right-0 z-20 mt-1 min-w-48 p-1"
                aria-label="Photos and barcode"
                (keydown.escape)="closeMenu($event)"
                (keydown.arrowdown)="moveFocus(1, $event)"
                (keydown.arrowup)="moveFocus(-1, $event)"
              >
                <button
                  #firstMenuItem
                  type="button"
                  role="menuitem"
                  [class]="menuItemClass"
                  (click)="openCamera()"
                >
                  Take photos
                </button>
                <button
                  type="button"
                  role="menuitem"
                  [class]="menuItemClass"
                  (click)="pickPhoto(fileInput)"
                >
                  Add photo from files
                </button>
                <button type="button" role="menuitem" [class]="menuItemClass" (click)="openScan()">
                  Scan barcode
                </button>
              </div>
            }
          </div>
        </div>

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

        @if (barcode(); as code) {
          <div class="mt-3 flex items-center gap-2">
            <app-barcode-image class="min-w-0 flex-1" [barcode]="code" label="the new piece" />
            <button
              type="button"
              class="btn-danger shrink-0"
              aria-label="Remove the barcode"
              (click)="barcode.set(null)"
            >
              Remove
            </button>
          </div>
        }

        @if (shots().length > 0) {
          <ul class="mt-3 flex flex-wrap gap-2" aria-label="Photos of the new piece">
            @for (shot of shots(); track shot.id) {
              <li class="relative">
                <img
                  class="h-16 w-16 rounded-lg border border-stone-300 object-cover dark:border-stone-700"
                  [src]="shot.url"
                  [alt]="'Photo ' + ($index + 1) + ' of the new piece'"
                />
                <button
                  type="button"
                  class="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full border border-stone-300 bg-white text-sm focus-visible:outline-2 focus-visible:outline-amber-700 dark:border-stone-700 dark:bg-stone-900 dark:focus-visible:outline-amber-400"
                  [attr.aria-label]="'Remove photo ' + ($index + 1)"
                  (click)="removeShot(shot.id)"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            }
          </ul>
        }

        <p class="mt-3 flex items-baseline justify-between text-sm tabular-nums" aria-live="polite">
          <span class="muted">Price after tax</span>
          <span class="text-lg font-semibold text-amber-800 dark:text-amber-300">
            {{ price().priceAfterTax | inr }}
          </span>
        </p>

        <div class="sheet-footer">
          <button type="submit" class="btn-primary flex-1">Add</button>
          <button type="button" class="btn-quiet" (click)="add($event, true)">More options</button>
          <button type="button" class="btn-quiet" (click)="closed.emit()">Cancel</button>
        </div>
      </form>

      <!-- The menu opens this. It stays outside the menu, so its change event still
           arrives after the menu closes. -->
      <input
        #fileInput
        class="sr-only"
        type="file"
        accept="image/*"
        multiple
        tabindex="-1"
        aria-hidden="true"
        (change)="addFiles($event)"
      />

      <app-camera-dialog
        [open]="cameraOpen()"
        label="the new piece"
        (saved)="addShots($event)"
        (closed)="cameraOpen.set(false)"
      />
      <app-scan-dialog
        [open]="scanOpen()"
        label="the new piece"
        (scanned)="barcode.set($event)"
        (closed)="scanOpen.set(false)"
      />
    </dialog>
  `,
})
export class QuickAddDialog {
  readonly open = input.required<boolean>();
  readonly closed = output<void>();
  /** The user asked for more options. The value is the id of the new piece to edit. */
  readonly moreOptions = output<string>();

  protected readonly store = inject(GoldStore);
  private readonly images = inject(ImageStore);
  protected readonly metals = METALS;
  protected readonly metalNames = METAL_NAMES;
  protected readonly karats = KARATS;

  /**
   * The model keeps the metal, the karat, and the making charge for the next piece. The
   * weight and the name start empty each time.
   */
  protected readonly model = signal<NewArticle>({
    name: '',
    metal: 'gold',
    karat: 22,
    weightGrams: Number.NaN,
    makingChargePercent: Number.NaN,
  });
  protected readonly f = form(this.model, quickSchema);

  protected readonly price = computed(() => {
    const piece = this.model();
    return computeArticle(
      {
        metal: piece.metal,
        karat: piece.karat,
        weightGrams: num(piece.weightGrams),
        makingChargePercent: num(piece.makingChargePercent),
        makingDiscountPercent: 0,
        makingOnStones: false,
        bookingDate: '',
        purchaseDate: '',
        stones: [],
      },
      this.store.pricing(),
    );
  });

  protected readonly menuOpen = signal(false);
  protected readonly cameraOpen = signal(false);
  protected readonly scanOpen = signal(false);
  /** The photos for the new piece, in the order the user took them. */
  protected readonly shots = signal<Shot[]>([]);
  /** The barcode the scan read for the new piece, or null. */
  protected readonly barcode = signal<Barcode | null>(null);
  protected readonly menuItemClass =
    'flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-amber-700 dark:hover:bg-stone-800 dark:focus-visible:outline-amber-400';

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly menuRoot = viewChild.required<ElementRef<HTMLElement>>('menuRoot');
  private readonly menuButton = viewChild.required<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly firstMenuItem = viewChild<ElementRef<HTMLButtonElement>>('firstMenuItem');
  private readonly weightField = viewChild.required<ElementRef<HTMLInputElement>>('weightField');

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;

      if (this.open()) {
        if (!dialog.open) {
          dialog.showModal();
          this.weightField().nativeElement.focus();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });

    // Move the focus into the menu when it opens.
    effect(() => this.firstMenuItem()?.nativeElement.focus());

    inject(DestroyRef).onDestroy(() => this.clearExtras());
  }

  /** Escape or Cancel closes the dialog. The photos and the barcode go with it. */
  protected onDialogClose(): void {
    this.menuOpen.set(false);
    this.clearExtras();
    this.closed.emit();
  }

  /** Escape closes the menu only, not the dialog under it. */
  protected closeMenu(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.menuOpen.set(false);
    this.menuButton().nativeElement.focus();
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

  /** The arrow keys move the focus through the menu items, and wrap at the ends. */
  protected moveFocus(step: number, event: Event): void {
    event.preventDefault();
    const items = [
      ...this.menuRoot().nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  }

  protected openCamera(): void {
    this.menuOpen.set(false);
    this.cameraOpen.set(true);
  }

  protected openScan(): void {
    this.menuOpen.set(false);
    this.scanOpen.set(true);
  }

  protected pickPhoto(input: HTMLInputElement): void {
    this.menuOpen.set(false);
    input.click();
  }

  protected addFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    this.addShots(files);
  }

  protected addShots(files: readonly File[]): void {
    const added = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
    }));
    this.shots.update((shots) => [...shots, ...added]);
  }

  protected removeShot(id: string): void {
    const shot = this.shots().find((item) => item.id === id);
    if (shot) {
      URL.revokeObjectURL(shot.url);
      this.shots.update((shots) => shots.filter((item) => item.id !== id));
    }
  }

  protected setMetal(metal: Metal): void {
    this.model.update((current) => ({ ...current, metal }));
  }

  protected setKarat(karat: number): void {
    this.model.update((current) => ({ ...current, karat }));
  }

  /**
   * Add the piece and close. With `more`, the shell then opens the piece in edit mode,
   * which has every field. The weight and the name clear for the next piece.
   */
  protected add(event: Event, more = false): void {
    event.preventDefault();

    if (this.f.karat().errors().length > 0) {
      return;
    }

    const piece = this.model();
    const article = this.store.addArticle({
      ...piece,
      karat: piece.metal === 'gold' ? piece.karat : this.store.displayKarat(),
      weightGrams: num(piece.weightGrams),
      makingChargePercent: num(piece.makingChargePercent),
      barcode: this.barcode() ?? undefined,
    });

    // The photos save after the dialog closes. The card of the piece shows each one as
    // it arrives. A failed save leaves the piece without that photo.
    const files = this.shots().map((shot) => shot.file);
    if (article && files.length > 0) {
      this.images.add(article.id, files).catch(() => undefined);
    }

    this.model.update((current) => ({ ...current, name: '', weightGrams: Number.NaN }));
    this.clearExtras();
    this.closed.emit();

    if (more && article) {
      this.moreOptions.emit(article.id);
    }
  }

  private clearExtras(): void {
    for (const shot of this.shots()) {
      URL.revokeObjectURL(shot.url);
    }
    this.shots.set([]);
    this.barcode.set(null);
  }
}

function num(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
