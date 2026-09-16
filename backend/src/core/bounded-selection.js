// Max heap of the best K entries. The caller supplies a total comparator,
// including input position when stable ordering matters.
export function boundedSelection(limit, compare) {
  const heap = [];
  return {
    add(value) {
      if (limit <= 0) return;
      if (heap.length < limit) {
        let index = heap.length;
        heap.push(value);
        while (index > 0) {
          const parent = (index - 1) >> 1;
          if (compare(heap[parent], value) >= 0) break;
          heap[index] = heap[parent];
          index = parent;
        }
        heap[index] = value;
        return;
      }
      if (compare(value, heap[0]) >= 0) return;
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) > 0) child++;
        if (compare(value, heap[child]) >= 0) break;
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = value;
    },
    sorted: () => heap.sort(compare),
  };
}
