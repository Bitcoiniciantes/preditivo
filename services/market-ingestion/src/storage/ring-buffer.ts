export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  getAll(): T[] {
    if (this.count === 0) return [];
    const result: T[] = [];
    const start = this.count < this.capacity
      ? 0
      : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  last(): T | undefined {
    if (this.count === 0) return undefined;
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity];
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}
