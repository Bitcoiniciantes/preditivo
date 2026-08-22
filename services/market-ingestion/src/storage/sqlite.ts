import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SQLiteStorage {
  private db: InstanceType<typeof DatabaseSync>;
  private insertSnapshotStmt!: ReturnType<InstanceType<typeof DatabaseSync>['prepare']>;
  private insertEventStmt!: ReturnType<InstanceType<typeof DatabaseSync>['prepare']>;

  constructor() {
    const dataDir = process.env.NODE_ENV === 'production' ? '/data' : path.join(__dirname, '../../data');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'market.db');
    console.log(`[DB] Conectando ao SQLite em: ${dbPath}`);

    this.db = new DatabaseSync(dbPath);

    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA temp_store = MEMORY');

    this.initSchema();
    this.prepareStatements();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        price REAL,
        oi REAL,
        oi_change REAL,
        funding_rate REAL,
        cvd REAL,
        cvd_large REAL,
        book_imbalance REAL,
        score INTEGER,
        regime TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        event_type TEXT,
        magnitude REAL,
        direction TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(timestamp);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp);`);
  }

  private prepareStatements(): void {
    this.insertSnapshotStmt = this.db.prepare(`
      INSERT INTO snapshots (
        timestamp, symbol, price, oi, oi_change, funding_rate,
        cvd, cvd_large, book_imbalance, score, regime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertEventStmt = this.db.prepare(`
      INSERT INTO events (
        timestamp, symbol, event_type, magnitude, direction, details
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
  }

  public saveSnapshot(data: {
    timestamp: number;
    symbol?: string;
    price?: number;
    oi?: number;
    oiChange?: number;
    fundingRate?: number;
    cvd?: number;
    cvdLarge?: number;
    bookImbalance?: number;
    score?: number;
    regime?: string;
  }): void {
    try {
      this.insertSnapshotStmt.run(
        data.timestamp,
        data.symbol || 'BTCUSDT',
        data.price || 0,
        data.oi || 0,
        data.oiChange || 0,
        data.fundingRate || 0,
        data.cvd || 0,
        data.cvdLarge || 0,
        data.bookImbalance || 0,
        data.score || 0,
        data.regime || 'NEUTRAL'
      );
    } catch (error) {
      console.error('[DB] Erro ao salvar snapshot:', error);
    }
  }

  public saveEvent(data: {
    timestamp: number;
    symbol?: string;
    eventType: string;
    magnitude?: number;
    direction: string;
    details?: string;
  }): void {
    try {
      this.insertEventStmt.run(
        data.timestamp,
        data.symbol || 'BTCUSDT',
        data.eventType,
        data.magnitude || 0,
        data.direction,
        data.details || ''
      );
    } catch (error) {
      console.error('[DB] Erro ao salvar evento:', error);
    }
  }

  public close(): void {
    this.db.close();
  }
}

export const dbStorage = new SQLiteStorage();
