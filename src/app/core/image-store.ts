import { DestroyRef, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import * as db from './gold-db';
import { ArticleImage } from './models';
import { resizeImage } from './image-resize';

/**
 * The photo path.
 *
 * Photos stay out of `GoldStore` because a blob must not sit in a signal that an effect
 * writes on every keystroke. This service loads the photos of one article on demand and
 * caches one object URL per photo. It revokes every URL it created.
 */
@Service()
export class ImageStore {
  private readonly lists = new Map<string, WritableSignal<ArticleImage[]>>();
  private readonly urls = new Map<string, string>();
  private readonly busy = signal(0);

  /** True while a photo is on its way in. The card shows a progress note. */
  readonly working = this.busy.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.revokeAll());
  }

  /**
   * The photos of one article. The first call starts the read from IndexedDB. Call it
   * once per component, then read the signal in the template.
   */
  imagesFor(articleId: string): Signal<ArticleImage[]> {
    const existing = this.lists.get(articleId);

    if (existing) {
      return existing.asReadonly();
    }

    const list = signal<ArticleImage[]>([]);
    this.lists.set(articleId, list);
    void db.loadImages(articleId).then((images) => list.set(images));

    return list.asReadonly();
  }

  /** The object URL for one photo. The same photo always gets the same URL. */
  urlFor(image: ArticleImage): string {
    const existing = this.urls.get(image.id);

    if (existing) {
      return existing;
    }

    const url = URL.createObjectURL(image.blob);
    this.urls.set(image.id, url);
    return url;
  }

  /** Downscale each file, store it, then show it. */
  async add(articleId: string, files: readonly File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    this.busy.update((count) => count + files.length);

    try {
      for (const file of files) {
        const resized = await resizeImage(file);
        const image: ArticleImage = {
          id: crypto.randomUUID(),
          articleId,
          blob: resized.blob,
          width: resized.width,
          height: resized.height,
          createdAt: Date.now(),
        };

        await db.putImage(image);
        this.listFor(articleId).update((images) => [...images, image]);
        this.busy.update((count) => count - 1);
      }
    } catch (error) {
      this.busy.set(0);
      throw error;
    }
  }

  async remove(image: ArticleImage): Promise<void> {
    await db.deleteImage(image.id);
    this.listFor(image.articleId).update((images) => images.filter((one) => one.id !== image.id));
    this.revoke(image.id);
  }

  /**
   * Drop the cached URLs after `GoldStore` deletes an article or a collection. The rows
   * are gone from IndexedDB already.
   */
  forget(imageIds: readonly string[], articleIds: readonly string[]): void {
    for (const id of imageIds) {
      this.revoke(id);
    }
    for (const id of articleIds) {
      this.lists.delete(id);
    }
  }

  private listFor(articleId: string): WritableSignal<ArticleImage[]> {
    let list = this.lists.get(articleId);

    if (!list) {
      list = signal<ArticleImage[]>([]);
      this.lists.set(articleId, list);
    }

    return list;
  }

  private revoke(imageId: string): void {
    const url = this.urls.get(imageId);

    if (url) {
      URL.revokeObjectURL(url);
      this.urls.delete(imageId);
    }
  }

  private revokeAll(): void {
    for (const url of this.urls.values()) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }
}
