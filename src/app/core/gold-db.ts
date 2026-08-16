import { Article, ArticleImage, Collection, Settings } from './models';

/**
 * The IndexedDB layer. It wraps the raw browser API in promises, so the app needs no
 * database dependency. IndexedDB stores a `Blob` as it stands, so a photo needs no
 * encode to text.
 */

const DB_NAME = 'gold-buyer';
const DB_VERSION = 1;

export const STORE_SETTINGS = 'settings';
export const STORE_COLLECTIONS = 'collections';
export const STORE_ARTICLES = 'articles';
export const STORE_IMAGES = 'images';

const INDEX_BY_COLLECTION = 'byCollection';
const INDEX_BY_ARTICLE = 'byArticle';

export interface DatabaseSnapshot {
  settings: Settings | undefined;
  collections: Collection[];
  articles: Article[];
}

let connection: Promise<IDBDatabase> | undefined;

/** Open the database once, then reuse the connection. */
export function openDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
        db.createObjectStore(STORE_COLLECTIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ARTICLES)) {
        const articles = db.createObjectStore(STORE_ARTICLES, { keyPath: 'id' });
        articles.createIndex(INDEX_BY_COLLECTION, 'collectionId');
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        const images = db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
        images.createIndex(INDEX_BY_ARTICLE, 'articleId');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return connection;
}

/** Read everything except the photos. The photos load per article, on demand. */
export async function loadSnapshot(): Promise<DatabaseSnapshot> {
  const db = await openDatabase();
  const tx = db.transaction([STORE_SETTINGS, STORE_COLLECTIONS, STORE_ARTICLES], 'readonly');

  const [settings, collections, articles] = await Promise.all([
    request<Settings[]>(tx.objectStore(STORE_SETTINGS).getAll()),
    request<Collection[]>(tx.objectStore(STORE_COLLECTIONS).getAll()),
    request<Article[]>(tx.objectStore(STORE_ARTICLES).getAll()),
  ]);

  return { settings: settings[0], collections, articles };
}

export async function putSettings(settings: Settings): Promise<void> {
  await write(STORE_SETTINGS, (store) => store.put(settings));
}

export async function putCollection(collection: Collection): Promise<void> {
  await write(STORE_COLLECTIONS, (store) => store.put(collection));
}

export async function putArticle(article: Article): Promise<void> {
  await write(STORE_ARTICLES, (store) => store.put(article));
}

export async function putImage(image: ArticleImage): Promise<void> {
  await write(STORE_IMAGES, (store) => store.put(image));
}

export async function deleteImage(id: string): Promise<void> {
  await write(STORE_IMAGES, (store) => store.delete(id));
}

export async function loadImages(articleId: string): Promise<ArticleImage[]> {
  const db = await openDatabase();
  const index = db
    .transaction(STORE_IMAGES, 'readonly')
    .objectStore(STORE_IMAGES)
    .index(INDEX_BY_ARTICLE);

  const images = await request<ArticleImage[]>(index.getAll(articleId));
  return images.sort((a, b) => a.createdAt - b.createdAt);
}

/** Delete one article and every photo that belongs to it. */
export async function deleteArticleDeep(articleId: string): Promise<string[]> {
  const db = await openDatabase();
  const tx = db.transaction([STORE_ARTICLES, STORE_IMAGES], 'readwrite');
  const images = tx.objectStore(STORE_IMAGES);

  tx.objectStore(STORE_ARTICLES).delete(articleId);
  const imageIds = await request<string[]>(
    images.index(INDEX_BY_ARTICLE).getAllKeys(articleId) as IDBRequest<string[]>,
  );
  for (const id of imageIds) {
    images.delete(id);
  }

  await done(tx);
  return imageIds;
}

/**
 * Delete one collection, its articles, and their photos. One transaction covers the
 * whole cascade, so a failure leaves no orphan row behind.
 */
export async function deleteCollectionDeep(collectionId: string): Promise<string[]> {
  const db = await openDatabase();
  const tx = db.transaction([STORE_COLLECTIONS, STORE_ARTICLES, STORE_IMAGES], 'readwrite');
  const articles = tx.objectStore(STORE_ARTICLES);
  const images = tx.objectStore(STORE_IMAGES);

  tx.objectStore(STORE_COLLECTIONS).delete(collectionId);
  const articleIds = await request<string[]>(
    articles.index(INDEX_BY_COLLECTION).getAllKeys(collectionId) as IDBRequest<string[]>,
  );

  const imageIds: string[] = [];
  for (const articleId of articleIds) {
    articles.delete(articleId);
    const ids = await request<string[]>(
      images.index(INDEX_BY_ARTICLE).getAllKeys(articleId) as IDBRequest<string[]>,
    );
    for (const id of ids) {
      images.delete(id);
      imageIds.push(id);
    }
  }

  await done(tx);
  return imageIds;
}

async function write(
  storeName: string,
  action: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  action(tx.objectStore(storeName));
  await done(tx);
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
