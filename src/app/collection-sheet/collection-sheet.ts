import { Component, effect, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { GoldStore } from '../core/gold-store';
import { Collection } from '../core/models';

/**
 * The shop list.
 *
 * A native `<dialog>` opened with `showModal()` gives the focus trap, the backdrop, and
 * the Escape key without any extra code.
 */
@Component({
  selector: 'app-collection-sheet',
  template: `
    <dialog #sheet class="sheet" aria-labelledby="sheet-title" (close)="closed.emit()">
      <h2 id="sheet-title" class="mb-3 text-lg font-semibold">Shops</h2>

      <ul class="flex flex-col gap-2">
        @for (collection of store.collections(); track collection.id) {
          <li class="flex items-center gap-2">
            @if (renamingId() === collection.id) {
              <input
                #title
                class="input"
                type="text"
                [value]="collection.title"
                [attr.aria-label]="'New name for ' + collection.title"
                (keydown.enter)="commitRename(collection, title.value)"
              />
              <button type="button" class="btn-primary" (click)="commitRename(collection, title.value)">
                Save
              </button>
            } @else if (deletingId() === collection.id) {
              <p class="flex-1 text-sm">
                Delete {{ collection.title }} and its
                {{ store.articleCount(collection.id) }}
                {{ store.articleCount(collection.id) === 1 ? 'item' : 'items' }}?
              </p>
              <button type="button" class="btn-danger" (click)="confirmDelete(collection)">
                Delete
              </button>
              <button type="button" class="btn-quiet" (click)="deletingId.set(null)">Keep</button>
            } @else {
              <button
                type="button"
                class="btn-quiet flex-1 justify-between"
                [attr.aria-pressed]="collection.id === store.activeCollection()?.id"
                (click)="use(collection)"
              >
                <span class="truncate">{{ collection.title }}</span>
                <span class="muted text-xs">
                  {{ store.articleCount(collection.id) }}
                  {{ store.articleCount(collection.id) === 1 ? 'item' : 'items' }}
                  @if (collection.id === store.activeCollection()?.id) {
                    <span class="text-amber-700 dark:text-amber-400">· open</span>
                  }
                </span>
              </button>
              <button
                type="button"
                class="btn-quiet"
                [attr.aria-label]="'Rename ' + collection.title"
                (click)="renamingId.set(collection.id)"
              >
                Rename
              </button>
              <button
                type="button"
                class="btn-danger"
                [attr.aria-label]="'Delete ' + collection.title"
                (click)="deletingId.set(collection.id)"
              >
                Delete
              </button>
            }
          </li>
        }
      </ul>

      <div class="mt-4 flex gap-2">
        <button type="button" class="btn-primary flex-1" (click)="add()">Add a shop</button>
        <button type="button" class="btn-quiet" (click)="closed.emit()">Close</button>
      </div>
    </dialog>
  `,
})
export class CollectionSheet {
  readonly open = input.required<boolean>();
  readonly closed = output<void>();

  protected readonly store = inject(GoldStore);
  protected readonly renamingId = signal<string | null>(null);
  protected readonly deletingId = signal<string | null>(null);

  private readonly sheet = viewChild.required<ElementRef<HTMLDialogElement>>('sheet');

  constructor() {
    effect(() => {
      const dialog = this.sheet().nativeElement;

      if (this.open()) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }

  protected use(collection: Collection): void {
    this.store.setActiveCollection(collection.id);
    this.closed.emit();
  }

  protected add(): void {
    this.store.addCollection('');
    this.closed.emit();
  }

  protected commitRename(collection: Collection, title: string): void {
    this.store.renameCollection(collection.id, title);
    this.renamingId.set(null);
  }

  protected confirmDelete(collection: Collection): void {
    this.deletingId.set(null);
    void this.store.removeCollection(collection.id);
  }
}
