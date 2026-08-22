declare module 'node:sqlite' {
  class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: unknown[]): void;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
    close(): void;
  }
  export { DatabaseSync };
}
