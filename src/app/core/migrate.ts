import { isoDay } from './dates';
import {
  Article,
  Barcode,
  Collection,
  DEFAULT_BARCODE_TYPE,
  GoldRate,
  Metal,
  METALS,
  Stone,
  STONE_UNITS,
  StoneRate,
  StoneUnit,
} from './models';

/**
 * Bring a row from an older version of the app up to the current shape.
 *
 * IndexedDB keeps whatever the old version wrote, so the store runs every row through
 * these functions when it loads. A row that is already current comes back with the same
 * values. A missing field gets the value that gives the old price.
 */

type Row = Record<string, unknown>;

export function migrateCollection(value: object): Collection {
  const row = value as Row;
  return {
    id: String(row['id']),
    title: String(row['title'] ?? ''),
    goldRates: migrateGoldRates(row),
    displayKarat:
      row['displayKarat'] === 24 || row['displayKarat'] === 18 ? row['displayKarat'] : 22,
    silverPricePerGram: number(row['silverPricePerGram']),
    platinumPricePerGram: number(row['platinumPricePerGram']),
    stoneRates: list(row['stoneRates']).map(migrateStoneRate),
    createdAt: number(row['createdAt']),
  };
}

export function migrateArticle(value: object): Article {
  const row = value as Row;
  return {
    id: String(row['id']),
    collectionId: String(row['collectionId']),
    name: String(row['name'] ?? ''),
    notes: String(row['notes'] ?? ''),
    barcode: migrateBarcode(row),
    metal: METALS.includes(row['metal'] as Metal) ? (row['metal'] as Metal) : 'gold',
    karat: number(row['karat'], 22),
    // Version 1 called the metal weight `goldWeightGrams`.
    weightGrams: number(row['weightGrams'] ?? row['goldWeightGrams']),
    makingChargePercent: number(row['makingChargePercent']),
    makingDiscountPercent: number(row['makingDiscountPercent']),
    makingOnStones: row['makingOnStones'] === true,
    bookingDate: day(row['bookingDate']),
    purchaseDate: day(row['purchaseDate']),
    stones: list(row['stones']).map(migrateStone),
    selected: row['selected'] !== false,
    createdAt: number(row['createdAt']),
  };
}

/**
 * Version 1 kept one 24kt rate per shop. That rate becomes the first dated rate, on the
 * day the shop was made.
 */
function migrateGoldRates(row: Row): GoldRate[] {
  if (Array.isArray(row['goldRates'])) {
    return list(row['goldRates']).map((rate) => ({
      id: String(rate['id'] ?? crypto.randomUUID()),
      date: day(rate['date']) || isoDay(),
      karat: number(rate['karat'], 24) || 24,
      rate: number(rate['rate']),
    }));
  }

  const price24 = number(row['pricePerGram24']);
  if (price24 <= 0) {
    return [];
  }
  return [
    {
      id: crypto.randomUUID(),
      date: isoDay(number(row['createdAt'], Date.now())),
      karat: 24,
      rate: price24,
    },
  ];
}

/**
 * The barcode as one object. The first barcode version kept the value in `barcode` and
 * the format in `barcodeFormat`.
 */
function migrateBarcode(row: Row): Barcode {
  const value = row['barcode'];

  if (value && typeof value === 'object') {
    const barcode = value as Row;
    return {
      data: String(barcode['data'] ?? ''),
      type: String(barcode['type'] || DEFAULT_BARCODE_TYPE),
    };
  }

  return {
    data: typeof value === 'string' ? value : '',
    type: String(row['barcodeFormat'] || DEFAULT_BARCODE_TYPE),
  };
}

function migrateStone(row: Row): Stone {
  return {
    id: String(row['id'] ?? crypto.randomUUID()),
    kind: String(row['kind'] ?? ''),
    rateId: typeof row['rateId'] === 'string' ? row['rateId'] : '',
    // Version 1 weighed every stone in grams.
    weight: number(row['weight'] ?? row['weightGrams']),
    unit: unit(row['unit']),
    price: number(row['price']),
  };
}

function migrateStoneRate(row: Row): StoneRate {
  return {
    id: String(row['id'] ?? crypto.randomUUID()),
    kind: String(row['kind'] ?? ''),
    unit: unit(row['unit']),
    rate: number(row['rate']),
  };
}

/** A `YYYY-MM-DD` day, or an empty string. */
function day(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function unit(value: unknown): StoneUnit {
  return STONE_UNITS.includes(value as StoneUnit) ? (value as StoneUnit) : 'g';
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function list(value: unknown): Row[] {
  return Array.isArray(value)
    ? (value.filter((item) => item && typeof item === 'object') as Row[])
    : [];
}
