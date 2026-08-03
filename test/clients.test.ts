import { describe, it, expect } from 'vitest';
import { renderClients, renderClient } from '../src/ui/clients';
import type { Customer } from '../src/db';

const customer: Customer = {
  id: 1,
  name: 'Test Client',
  address: '1 Main St',
  email: 'billing@example.com',
  archived: 0,
  workdrive_folder_id: 'abc123',
  notes: '',
  notice_days: 30,
};

describe('WorkDrive visibility is gated by profile.settings.workdriveEnabled', () => {
  it('renderClients hides the column and its data when disabled', () => {
    const html = renderClients('Acme', [customer], false);
    expect(html).not.toContain('WorkDrive');
    expect(html).not.toContain('filed');
  });

  it('renderClients shows the column and status when enabled', () => {
    const html = renderClients('Acme', [customer], true);
    expect(html).toContain('WorkDrive');
    expect(html).toContain('filed');
  });

  it('renderClients shows "—" for a client with no folder id yet, only when enabled', () => {
    const unfiled = { ...customer, workdrive_folder_id: null };
    const html = renderClients('Acme', [unfiled], true);
    expect(html).toContain('—');
  });

  it('renderClient omits the WorkDrive folder input when disabled', () => {
    const html = renderClient('Acme', customer, [], [], false);
    expect(html).not.toContain('workdriveFolderId');
    expect(html).not.toContain('WorkDrive folder id');
  });

  it('renderClient includes the WorkDrive folder input, pre-filled, when enabled', () => {
    const html = renderClient('Acme', customer, [], [], true);
    expect(html).toContain('workdriveFolderId');
    expect(html).toContain('abc123');
  });
});
