import { TestBed } from '@angular/core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { App } from './app';

/**
 * jsdom carries no IndexedDB. This stub answers the open call and then stays quiet, so
 * the store never reports itself ready and the shell shows its wait note. That is enough
 * to prove the shell renders. The price logic has its own suites, which need no browser.
 */
beforeAll(() => {
  if (!('indexedDB' in globalThis)) {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { open: () => ({ onsuccess: null, onerror: null, onupgradeneeded: null }) },
      configurable: true,
    });
  }
});

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the shell while the store loads', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('h1')?.textContent).toContain('Gold Buyer');
    expect(compiled.querySelector('app-rate-bar')).toBeTruthy();
    expect(compiled.querySelector('app-summary-bar')).toBeTruthy();
  });
});
