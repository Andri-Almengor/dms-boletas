function normalizedSheetNames(sheetNames) {
  if (!sheetNames) return null;
  return [...new Set([...sheetNames].map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

export function sheetNameFromRange(range) {
  const value = String(range || '').trim();
  const separator = value.indexOf('!');
  if (separator < 0) return value || '';
  const raw = value.slice(0, separator).trim();
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

export function readSheetNames(method, args = {}) {
  if (method === 'spreadsheets.get') return new Set(['*metadata*']);
  if (method === 'spreadsheets.values.get') {
    return new Set([sheetNameFromRange(args.range)].filter(Boolean));
  }
  if (method === 'spreadsheets.values.batchGet') {
    return new Set((args.ranges || []).map(sheetNameFromRange).filter(Boolean));
  }
  return new Set();
}

export function writeSheetNames(method, args = {}) {
  if (['spreadsheets.values.append', 'spreadsheets.values.update', 'spreadsheets.values.clear'].includes(method)) {
    const name = sheetNameFromRange(args.range);
    return name ? new Set([name]) : null;
  }
  if (method === 'spreadsheets.values.batchUpdate') {
    const names = (args.requestBody?.data || [])
      .map((item) => sheetNameFromRange(item?.range))
      .filter(Boolean);
    return names.length ? new Set(names) : null;
  }
  if (method === 'spreadsheets.values.batchClear') {
    const names = (args.requestBody?.ranges || [])
      .map(sheetNameFromRange)
      .filter(Boolean);
    return names.length ? new Set(names) : null;
  }
  // Structural or unknown writes can affect metadata/ranges globally.
  return null;
}

export function sheetSetsIntersect(left, right) {
  if (!left || !right) return false;
  for (const value of left) if (right.has(value)) return true;
  return false;
}

export class SheetRevisionTracker {
  constructor() {
    this.globalRevision = 0;
    this.sheetRevisions = new Map();
  }

  snapshot(sheetNames = new Set()) {
    const names = normalizedSheetNames(sheetNames) || [];
    return {
      globalRevision: this.globalRevision,
      sheets: names.map((name) => [name, this.sheetRevisions.get(name) || 0]),
    };
  }

  isCurrent(snapshot) {
    if (!snapshot || snapshot.globalRevision !== this.globalRevision) return false;
    return snapshot.sheets.every(([name, revision]) => (this.sheetRevisions.get(name) || 0) === revision);
  }

  same(left, right) {
    if (!left || !right || left.globalRevision !== right.globalRevision) return false;
    if (left.sheets.length !== right.sheets.length) return false;
    for (let index = 0; index < left.sheets.length; index += 1) {
      if (left.sheets[index][0] !== right.sheets[index][0] || left.sheets[index][1] !== right.sheets[index][1]) return false;
    }
    return true;
  }

  isSingleWriteAfter(snapshot, sheetNames) {
    const names = normalizedSheetNames(sheetNames);
    if (!snapshot || !names || !names.length || snapshot.globalRevision !== this.globalRevision) return false;
    const target = new Set(names);
    const snapshotNames = new Set(snapshot.sheets.map(([name]) => name));
    if (names.some((name) => !snapshotNames.has(name))) return false;
    for (const [name, revision] of snapshot.sheets) {
      const current = this.sheetRevisions.get(name) || 0;
      if (target.has(name)) {
        if (current !== revision + 1) return false;
      } else if (current !== revision) return false;
    }
    return true;
  }

  advance(sheetNames = null) {
    const names = normalizedSheetNames(sheetNames);
    if (!names) {
      this.globalRevision += 1;
      this.sheetRevisions.clear();
      return;
    }
    for (const name of names) this.sheetRevisions.set(name, (this.sheetRevisions.get(name) || 0) + 1);
  }

  snapshotState() {
    return {
      globalRevision: this.globalRevision,
      trackedSheets: this.sheetRevisions.size,
    };
  }
}
