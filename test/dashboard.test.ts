import { describe, expect, it } from 'vitest';
import { renderDashboard, type DashboardData } from '../src/ui/dashboard';
import { layout } from '../src/ui/layout';

function dashboard(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    business: 'Example', currency: 'USD', mileageRateCentsPerMile: 76,
    afterHoursStart: '16:30', customer: null, tasks: [], running: null,
    routes: [], recentMileage: [], invoices: [],
    ...overrides,
  };
}

describe('customizable dashboard', () => {
  it('renders modules in saved order and omits hidden modules normally', () => {
    const html = renderDashboard(dashboard({
      preferences: {
        order: ['mail', 'timer', 'manual-hours', 'mileage', 'invoices', 'unbilled', 'recent-mileage'],
        hidden: ['mileage'],
      },
    }));
    expect(html.indexOf('data-module="mail"')).toBeLessThan(html.indexOf('data-module="timer"'));
    expect(html).not.toContain('data-module="mileage"');
  });

  it('shows accessible movement and visibility controls while customizing', () => {
    const html = renderDashboard(dashboard({
      customizing: true,
      preferences: {
        order: ['timer', 'manual-hours', 'mileage', 'mail', 'invoices', 'unbilled', 'recent-mileage'],
        hidden: ['mail'],
      },
    }));
    expect(html).toContain('action="/dashboard/preferences"');
    expect(html).toContain('aria-label="Move Log hours worked down"');
    expect(html).toContain('aria-label="Show Mail"');
    expect(html).toContain('Done customizing');
  });

  it('puts the dashboard customization action in the header, not the page body', () => {
    const normal = renderDashboard(dashboard());
    const customizing = renderDashboard(dashboard({ customizing: true }));
    const normalHeader = normal.slice(normal.indexOf('<header>'), normal.indexOf('</header>'));
    const normalMain = normal.slice(normal.indexOf('<main>'), normal.indexOf('</main>'));
    const customizingHeader = customizing.slice(
      customizing.indexOf('<header>'),
      customizing.indexOf('</header>'),
    );

    expect(normalHeader).toContain('Customize dashboard');
    expect(normalMain).not.toContain('Customize dashboard');
    expect(customizingHeader).toContain('Done customizing');
    expect(normal).toContain('header nav{display:flex;flex-wrap:wrap');
    expect(layout({ title: 'Mail', business: 'Example', body: 'Mail' })).not.toContain(
      'Customize dashboard',
    );
  });

  it('does not render Recent mileage when there are no rows, even in customize mode', () => {
    expect(renderDashboard(dashboard({ customizing: true }))).not.toContain('data-module="recent-mileage"');
  });

  it('splits columns after four available modules when Recent mileage is empty', () => {
    const html = renderDashboard(dashboard({
      customizing: true,
      preferences: {
        order: ['timer', 'recent-mileage', 'manual-hours', 'mileage', 'mail', 'invoices', 'unbilled'],
        hidden: [],
      },
    }));
    const firstColumn = html.slice(html.indexOf('<div class="col">'), html.indexOf('</div>\n\n      <div class="col">'));
    expect(firstColumn.match(/data-module=/g)).toHaveLength(4);
  });

  it('renders Recent mileage when rows exist', () => {
    const html = renderDashboard(dashboard({ recentMileage: [{
      id: 1, customer_id: 1, task_id: null, route_id: null,
      occurred_local: '2026-09-10T12:00', miles: 12, billable: 1,
      reason: 'after hours', rate_cents_per_mile: 76, note: null, invoice_id: null,
    }] }));
    expect(html).toContain('data-module="recent-mileage"');
  });

  it('scopes compact card spacing to the dashboard', () => {
    const html = renderDashboard(dashboard());
    expect(html).toContain('.dashboard .card{padding-top:.65rem}');
    expect(html).toContain('<div class="dashboard">');
    expect(html).not.toMatch(/\n\.card\{padding-top:\.65rem\}/);
  });
});
