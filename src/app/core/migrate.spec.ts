import { describe, expect, it } from 'vitest';
import { migrateArticle } from './migrate';

const ROW = { id: 'a1', collectionId: 'c1', createdAt: 0 };

describe('migrateArticle barcode', () => {
  it('keeps a barcode object as it is', () => {
    const article = migrateArticle({ ...ROW, barcode: { data: '123', type: 'qrcode' } });

    expect(article.barcode).toEqual({ data: '123', type: 'qrcode' });
  });

  it('joins the two fields of the first barcode version into one object', () => {
    const article = migrateArticle({ ...ROW, barcode: '4006381333931', barcodeFormat: 'ean13' });

    expect(article.barcode).toEqual({ data: '4006381333931', type: 'ean13' });
  });

  it('gives a row with no barcode an empty Code 128 barcode', () => {
    expect(migrateArticle(ROW).barcode).toEqual({ data: '', type: 'code128' });
  });
});
