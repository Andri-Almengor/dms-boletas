// Conservative retained-data estimate, not a V8 heap measurement. Counts UTF-16
// strings and object slots without making a JSON string copy of the cached data.
export function retainedBytes(value, seen = new WeakSet()) {
  if (typeof value === 'string') return 40 + value.length * 2;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (!value || typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength + 64;
  if (value instanceof ArrayBuffer) return value.byteLength + 64;
  let bytes = 64;
  for (const key of Object.keys(value)) bytes += 24 + key.length * 2 + retainedBytes(value[key], seen);
  return bytes;
}
export class BoundedCache extends Map {
  constructor({ maxBytes, maxEntries = 100 }) {
    super(); this.maxBytes = maxBytes; this.maxEntries = maxEntries;
    this.bytes = 0; this.weights = new Map(); this.evictions = 0;
  }
  set(key, value) {
    const weight = retainedBytes(value);
    this.delete(key);
    if (weight > this.maxBytes) return this; // Caller still receives full result.
    while (this.size && (this.bytes + weight > this.maxBytes || this.size >= this.maxEntries)) {
      this.delete(this.keys().next().value); this.evictions++;
    }
    super.set(key, value); this.weights.set(key, weight); this.bytes += weight;
    return this;
  }
  get(key) {
    const value = super.get(key);
    if (super.has(key)) { super.delete(key); super.set(key, value); }
    return value;
  }
  delete(key) {
    if (!super.has(key)) return false;
    this.bytes -= this.weights.get(key) || 0; this.weights.delete(key);
    return super.delete(key);
  }
  clear() { super.clear(); this.weights.clear(); this.bytes = 0; }
  snapshot() { return { entries:this.size, estimatedBytes:this.bytes, maxBytes:this.maxBytes, evictions:this.evictions }; }
}
