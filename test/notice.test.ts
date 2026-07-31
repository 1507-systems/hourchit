import { describe, expect, it } from 'vitest';
import { noticeText, type NoticeTerms, type NoticeView } from '../src/ui/notice';

const BASE: NoticeTerms = {
  incrementMinutes: 15,
  minimum: '60',
  mileageCents: 76,
  mileageBillable: true,
};

function view(over: Partial<NoticeView> = {}): NoticeView {
  return {
    business: {
      name: 'Tarnsby A/V Services LLC',
      address: '12 Harrow Bend\nTarnsby, CT 06701',
      email: 'tarnsby@bpsmail.net',
      phone: '(203) 555-0142',
    },
    todayLabel: 'Friday, July 31, 2026',
    effectiveLabel: 'Tuesday, September 1, 2026',
    noticeDays: 30,
    daysGiven: 32,
    before: BASE,
    after: { ...BASE, incrementMinutes: 30 },
    note: '',
    recipient: null,
    customers: [],
    versionId: 1,
    ...over,
  };
}

describe('the notice letter', () => {
  it('leads with what CHANGED, not with a restatement of everything', () => {
    // A client who cannot see the difference in ten seconds queries the first
    // invoice that follows.
    const t = noticeText(view());
    expect(t).toContain('What is changing:');
    expect(t).toContain('Billing increment: 15 minutes, rounded up  ->  30 minutes, rounded up');
  });

  it('leaves unchanged terms out of the change list', () => {
    const changes = noticeText(view()).split('The terms in full')[0];
    expect(changes).not.toContain('Minimum call-out');
    expect(changes).not.toContain('Mileage');
  });

  it('still states the terms in full, so the letter stands alone', () => {
    const t = noticeText(view());
    expect(t).toContain('The terms in full from Tuesday, September 1, 2026:');
    expect(t).toContain('Minimum call-out: 1 h');
    expect(t).toContain('Mileage: $0.76 per mile');
  });

  it('spells out a day-split minimum rather than leaking JSON at a client', () => {
    const t = noticeText(view({ after: { ...BASE, minimum: '{"weekday":0,"weekend":240}' } }));
    expect(t).toContain('none on weekdays, 4 h at weekends');
    expect(t).not.toContain('weekday":');
  });

  it('says when mileage is recorded but not charged', () => {
    const t = noticeText(view({ after: { ...BASE, mileageBillable: false } }));
    expect(t).toContain('recorded but not charged');
  });

  it('addresses the recipient when one is chosen', () => {
    const t = noticeText(
      view({
        recipient: {
          id: 1,
          name: 'Grandvale College',
          address: '800 Founders Way\nGrandvale, CT 06801',
          email: 'ap@grandvale.example',
        },
      }),
    );
    expect(t).toContain('Grandvale College\n800 Founders Way\nGrandvale, CT 06801');
  });

  it('has no change list when there is nothing to compare against', () => {
    // The first version ever recorded has no predecessor; the letter still
    // needs to state the terms rather than rendering an empty diff.
    const t = noticeText(view({ before: null }));
    expect(t).not.toContain('What is changing:');
    expect(t).toContain('The terms in full');
  });

  it('never claims to have been sent', () => {
    // The app can enforce that a date leaves room for notice. It cannot know
    // notice was served, and a letter that implies otherwise is worse than none.
    const t = noticeText(view()).toLowerCase();
    for (const claim of ['has been sent', 'we have notified', 'this was emailed']) {
      expect(t).not.toContain(claim);
    }
  });
});

describe('changed terms stay marked wherever they appear', () => {
  it('marks the changed lines in the full statement of terms', () => {
    // Bryce, 2026-07-31: "I like the convention of bolding terms that changed
    // in the notices." Bold carries it in HTML; plain text has no bold, so the
    // mailed copy says so instead of losing the emphasis silently.
    const t = noticeText(view());
    expect(t).toContain('Billing increment: 30 minutes, rounded up  (changed)');
  });

  it('leaves unchanged lines unmarked', () => {
    const t = noticeText(view());
    expect(t).toContain('Minimum call-out: 1 h\n');
    expect(t).not.toContain('Minimum call-out: 1 h  (changed)');
  });

  it('marks nothing when there is no predecessor to compare against', () => {
    expect(noticeText(view({ before: null }))).not.toContain('(changed)');
  });
});
