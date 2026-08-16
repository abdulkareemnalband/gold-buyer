import { Pipe, PipeTransform } from '@angular/core';
import { formatInr, formatInrExact, formatNumber } from './inr';

/** `{{ price | inr }}` for a rounded rupee amount, `{{ price | inr: 'exact' }}` for paise. */
@Pipe({ name: 'inr' })
export class InrPipe implements PipeTransform {
  transform(value: number, mode: 'round' | 'exact' = 'round'): string {
    return mode === 'exact' ? formatInrExact(value) : formatInr(value);
  }
}

/** `{{ grams | grams }}` for a weight. */
@Pipe({ name: 'grams' })
export class GramsPipe implements PipeTransform {
  transform(value: number): string {
    return `${formatNumber(value)} g`;
  }
}
