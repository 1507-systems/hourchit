import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { renderInvoiceMailApp } from '../src/ui/invoice-mail-app';
import type { InvoiceMailAppView } from '../src/ui/invoice-mail-app';

const view = {
  business: 'Test',
  invoice: { id: 1, number: 'INV-1' },
  customerName: 'Client',
  to: 'client@example.test',
  draft: {
    to: 'client@example.test',
    subject: 'Invoice',
    body: 'Complete invoice\nTOTAL DUE $125.00',
    html: '<p>Complete invoice</p><strong>TOTAL DUE $125.00</strong>',
  },
  mailtoHref: 'mailto:client@example.test?subject=Invoice',
  alreadySent: null,
} as InvoiceMailAppView;

async function clickCopy(clipboard: unknown, rich = true) {
  let click: (() => Promise<void>) | undefined;
  const state = { textContent: '' };
  const selected = { value: false };
  const elements: Record<string, any> = {
    'copy-email-body': {
      disabled: false,
      addEventListener(_event: string, fn: () => Promise<void>) {
        click = fn;
      },
    },
    'email-copy-status': state,
    'email-body-text': {
      value: view.draft.body,
      focus() {},
      select() {
        selected.value = true;
      },
      setSelectionRange() {},
    },
    'email-body-html': { value: view.draft.html },
  };
  const html = renderInvoiceMailApp(view);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  class Item {
    constructor(public data: Record<string, Blob>) {}
  }
  runInNewContext(script, {
    document: { getElementById: (id: string) => elements[id] },
    navigator: { clipboard },
    ClipboardItem: rich ? Item : undefined,
    Blob,
  });
  expect(click, 'copy button must have a working event handler').toBeTypeOf('function');
  await click!();
  return { state, selected, button: elements['copy-email-body'] };
}
describe('manual email body copying', () => {
  it('copies matching rich and plain bodies for the destination to choose', async () => {
    let data: Record<string, Blob> = {};
    const result = await clickCopy({
      async write(items: Array<{ data: Record<string, Blob> }>) {
        data = items[0].data;
      },
    });
    expect(await data['text/plain'].text()).toBe(view.draft.body);
    expect(await data['text/html'].text()).toBe(view.draft.html);
    expect(result.state.textContent).toContain('Body copied');
  });
  it('falls back to plain text when rich copying is rejected', async () => {
    let copied = '';
    const result = await clickCopy({
      async write() {
        throw new Error('Unsupported');
      },
      async writeText(text: string) {
        copied = text;
      },
    });
    expect(copied).toBe(view.draft.body);
    expect(result.state.textContent).toContain('Body copied');
  });
  it.each([
    undefined,
    {
      async writeText() {
        throw new Error('Denied');
      },
    },
  ])('selects visible text when clipboard is unavailable or denied', async (clipboard) => {
    const result = await clickCopy(clipboard, false);
    expect(result.selected.value).toBe(true);
    expect(result.state.textContent).toContain('Copy');
    expect(result.state.textContent).not.toContain('Body copied');
    expect(result.button.disabled).toBe(false);
  });
});
