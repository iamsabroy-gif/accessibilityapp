/**
 * Unit tests for admin.js pure functions.
 */

const {
  formatRemaining,
  formatDateTime,
  filterRows,
  sortRows,
  paginate,
  escapeCsvCell,
  toCsv
} = require('../frontend/admin.js');

describe('admin.js pure functions', () => {
  describe('formatRemaining', () => {
    test('handles zero and negative values', () => {
      expect(formatRemaining(0)).toBe('00:00');
      expect(formatRemaining(-5000)).toBe('00:00');
      expect(formatRemaining(null)).toBe('00:00');
    });

    test('formats minutes and seconds with zero-padding', () => {
      expect(formatRemaining(65000)).toBe('01:05');
      expect(formatRemaining(180000)).toBe('03:00');
      expect(formatRemaining((28 * 60 + 41) * 1000)).toBe('28:41');
    });
  });

  describe('formatDateTime', () => {
    test('returns never for empty input', () => {
      expect(formatDateTime('')).toBe('never');
      expect(formatDateTime(null)).toBe('never');
    });

    test('formats ISO strings into UTC representation', () => {
      const res = formatDateTime('2026-10-30T14:02:00Z');
      expect(res).toBe('2026-10-30 14:02 UTC');
    });
  });

  describe('filterRows', () => {
    const sampleUsers = [
      { email: 'alice@example.com', source: 'landing', registered: true, registered_at: '2026-10-01T10:00:00Z', last_seen: '2026-10-15T12:00:00Z' },
      { email: 'bob@partner.org', source: 'app', registered: true, registered_at: '2026-09-15T08:00:00Z', last_seen: '2026-10-05T09:00:00Z' },
      { email: 'charlie@temp.io', source: 'landing', registered: false, registered_at: '', last_seen: '2026-11-01T11:00:00Z' }
    ];

    test('filters by search query (case-insensitive email or source)', () => {
      expect(filterRows(sampleUsers, { q: 'ALICE' })).toHaveLength(1);
      expect(filterRows(sampleUsers, { q: 'partner' })).toHaveLength(1);
      expect(filterRows(sampleUsers, { q: 'landing' })).toHaveLength(2);
      expect(filterRows(sampleUsers, { q: 'nonexistent' })).toHaveLength(0);
    });

    test('filters by registration status', () => {
      expect(filterRows(sampleUsers, { status: 'registered' })).toHaveLength(2);
      expect(filterRows(sampleUsers, { status: 'unregistered' })).toHaveLength(1);
      expect(filterRows(sampleUsers, { status: 'all' })).toHaveLength(3);
    });

    test('filters by source', () => {
      expect(filterRows(sampleUsers, { source: 'landing' })).toHaveLength(2);
      expect(filterRows(sampleUsers, { source: 'app' })).toHaveLength(1);
    });

    test('filters by month', () => {
      // Bob registered in 2026-09
      expect(filterRows(sampleUsers, { month: '2026-09' })).toHaveLength(1);
      // Alice and Bob seen in 2026-10
      expect(filterRows(sampleUsers, { month: '2026-10' })).toHaveLength(2);
      // Charlie seen in 2026-11
      expect(filterRows(sampleUsers, { month: '2026-11' })).toHaveLength(1);
    });
  });

  describe('sortRows', () => {
    const sample = [
      { email: 'charlie@test.com', visit_days: 2, total_visits: 10, last_seen: '2026-10-01' },
      { email: 'alice@test.com', visit_days: 10, total_visits: 50, last_seen: '2026-10-20' },
      { email: 'bob@test.com', visit_days: 5, total_visits: 5, last_seen: '2026-10-10' }
    ];

    test('sorts string columns alphabetically', () => {
      const asc = sortRows(sample, 'email', 'asc');
      expect(asc.map(u => u.email)).toEqual(['alice@test.com', 'bob@test.com', 'charlie@test.com']);

      const desc = sortRows(sample, 'email', 'desc');
      expect(desc.map(u => u.email)).toEqual(['charlie@test.com', 'bob@test.com', 'alice@test.com']);
    });

    test('sorts numeric columns numerically', () => {
      const desc = sortRows(sample, 'total_visits', 'desc');
      expect(desc.map(u => u.total_visits)).toEqual([50, 10, 5]);

      const asc = sortRows(sample, 'visit_days', 'asc');
      expect(asc.map(u => u.visit_days)).toEqual([2, 5, 10]);
    });

    test('sorts dates properly', () => {
      const desc = sortRows(sample, 'last_seen', 'desc');
      expect(desc.map(u => u.last_seen)).toEqual(['2026-10-20', '2026-10-10', '2026-10-01']);
    });
  });

  describe('paginate', () => {
    const items = Array.from({ length: 55 }, (_, i) => i + 1);

    test('paginates correct slice and metadata', () => {
      const page1 = paginate(items, 1, 20);
      expect(page1.items).toHaveLength(20);
      expect(page1.totalPages).toBe(3);
      expect(page1.startIdx).toBe(1);
      expect(page1.endIdx).toBe(20);

      const page3 = paginate(items, 3, 20);
      expect(page3.items).toHaveLength(15);
      expect(page3.startIdx).toBe(41);
      expect(page3.endIdx).toBe(55);
    });

    test('handles empty and out of bounds', () => {
      const empty = paginate([], 1, 20);
      expect(empty.items).toHaveLength(0);
      expect(empty.totalPages).toBe(1);
      expect(empty.startIdx).toBe(0);

      const oob = paginate(items, 999, 20);
      expect(oob.page).toBe(3);
      expect(oob.items).toHaveLength(15);
    });
  });

  describe('CSV Export and Formula Injection Defense', () => {
    test('escapes formula injection characters (=, +, -, @, tab, cr)', () => {
      expect(escapeCsvCell('=1+1')).toBe(`"'=1+1"`);
      expect(escapeCsvCell('+cmd|')).toBe(`"'+cmd|"`);
      expect(escapeCsvCell('-2')).toBe(`"'-2"`);
      expect(escapeCsvCell('@malicious')).toBe(`"'@malicious"`);
      expect(escapeCsvCell('regular@example.com')).toBe(`"regular@example.com"`);
    });

    test('escapes internal quotes by doubling them', () => {
      expect(escapeCsvCell('He said "hello"')).toBe(`"He said ""hello"""`);
    });

    test('generates valid CSV with UTF-8 BOM', () => {
      const users = [
        { email: '=calc@test.com', registered: true, source: 'test', registered_at: '2026-10-01', visit_days: 1, total_visits: 2, last_seen: '2026-10-02' }
      ];
      const csv = toCsv(users);
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain(`"'=calc@test.com"`);
      expect(csv).toContain(`"Registered"`);
    });
  });
});
