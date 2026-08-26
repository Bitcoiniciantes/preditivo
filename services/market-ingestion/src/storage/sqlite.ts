import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Versão do schema (Fase 0, item 6 — PROJETO_COMPORTAMENTO_PREDITIVO_15Mv3 §44) ──
//   v1 = schema original (events sem coluna price)
//   v2 = events.price REAL adicionada + saveEvent() ligado ao fluxo de whale events
//   v3 = events.trade_id TEXT adicionada (id do aggTrade, P0-01 da auditoria — dedupe;
//        eventos antigos mantêm trade_id NULL, sem reprocessamento)
// Registro via PRAGMA user_version (mecanismo canônico do SQLite; auditável em sqlite_master).
const SCHEMA_VERSION = 3;

export class SQLiteStorage {
  private db: InstanceType<typeof DatabaseSync>;
  private insertSnapshotStmt!: ReturnType<InstanceType<typeof DatabaseSync>['prepare']>;
  private insertEventStmt!: ReturnType<InstanceType<typeof DatabaseSync>['prepare']>;
  private insertRegimeEventStmt!: ReturnType<InstanceType<typeof DatabaseSync>['prepare']>;

  constructor(dbPathOverride?: string) {
    const dataDir = dbPathOverride
      ? path.dirname(dbPathOverride)
      : process.env.NODE_ENV === 'production' ? '/data' : path.join(__dirname, '../../data');

    if (!dbPathOverride && !fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = dbPathOverride || path.join(dataDir, 'market.db');
    console.log(`[DB] Conectando ao SQLite em: ${dbPath}`);

    this.db = new DatabaseSync(dbPath);

    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA temp_store = MEMORY');

    this.initSchema();
    this.migrateSchema();
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
        price REAL,
        direction TEXT,
        details TEXT,
        trade_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(timestamp);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp);`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS regime_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        price REAL,
        confidence REAL,
        extra TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_regime_events_time ON regime_events(timestamp);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_regime_events_type ON regime_events(event_type);`);
  }

  /**
   * Migrações v2/v3 — idempotentes:
   *  - v2: adiciona `events.price` somente se ausente;
   *  - v3: adiciona `events.trade_id` (id do aggTrade) somente se ausente;
   *  - eventos antigos permanecem como estão: price NULL / trade_id NULL, sem reprocessamento;
   *  - registra o schema_version via PRAGMA user_version (somente upgrade, nunca downgrade).
   */
  private migrateSchema(): void {
    const cols = this.db.prepare('PRAGMA table_info(events)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'price')) {
      this.db.exec('ALTER TABLE events ADD COLUMN price REAL');
      console.log('[DB] Migração v2: coluna events.price adicionada (eventos antigos mantêm price NULL — sem preço histórico inventado).');
    }
    if (!cols.some((c) => c.name === 'trade_id')) {
      this.db.exec('ALTER TABLE events ADD COLUMN trade_id TEXT');
      console.log('[DB] Migração v3: coluna events.trade_id adicionada (eventos antigos mantêm trade_id NULL — sem reprocessamento).');
    }
    // Dedupe (P0-01): índice único parcial — eventos antigos (trade_id NULL) não são afetados;
    // eventos novos com o mesmo id de agregado são rejeitados (replay de reconexão).
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_trade_id ON events(trade_id) WHERE trade_id IS NOT NULL');

    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    const currentVersion = row?.user_version ?? 0;
    if (currentVersion < SCHEMA_VERSION) {
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      console.log(`[DB] schema_version registrado: ${currentVersion} → ${SCHEMA_VERSION}`);
    } else {
      console.log(`[DB] schema_version: ${currentVersion}`);
    }
  }

  public getSchemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    return row?.user_version ?? 0;
  }

  /**
   * Estatísticas de acumulação do SQLite — leitura leve e somente-leitura, usada pelo
   * broadcast para o painel observacional (Fase 1). Nada preditivo: apenas volume/gaps.
   */
  public getDbStats(): {
    snapshots: number;
    spanH: number;
    uptimeH: number;
    segments: number;
    gaps3min: number;
    whaleEvents: number;
    whaleSpanMin: number;
    regimeEvents: number;
  } {
    const s = this.db.prepare('SELECT COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx FROM snapshots').get() as { c: number; mn: number; mx: number };
    const w = this.db.prepare('SELECT COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx FROM events').get() as { c: number; mn: number; mx: number };
    const r = this.db.prepare('SELECT COUNT(*) c FROM regime_events').get() as { c: number };
    const rows = this.db.prepare('SELECT timestamp FROM snapshots ORDER BY timestamp').all() as { timestamp: number }[];
    let gaps = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i].timestamp - rows[i - 1].timestamp > 180_000) gaps++;
    return {
      snapshots: s.c,
      spanH: s.c ? (s.mx - s.mn) / 3_600_000 : 0,
      uptimeH: s.c / 60,
      segments: gaps + 1,
      gaps3min: gaps,
      whaleEvents: w.c,
      whaleSpanMin: w.c ? (w.mx - w.mn) / 60_000 : 0,
      regimeEvents: r.c,
    };
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
        timestamp, symbol, event_type, magnitude, price, direction, details, trade_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertRegimeEventStmt = this.db.prepare(`
      INSERT INTO regime_events (
        timestamp, event_type, from_state, to_state, price, confidence, extra
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
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
    price?: number;
    details?: string;
    tradeId?: number;
  }): void {
    try {
      this.insertEventStmt.run(
        data.timestamp,
        data.symbol || CONFIG.symbol,
        data.eventType,
        data.magnitude ?? 0,
        data.price ?? null,
        data.direction,
        data.details || '',
        data.tradeId !== undefined ? String(data.tradeId) : null
      );
    } catch (error) {
      console.error('[DB] Erro ao salvar evento:', error);
    }
  }

  public close(): void {
    this.db.close();
  }

  public saveRegimeEvent(data: {
    timestamp: number;
    eventType: string;
    fromState?: string;
    toState: string;
    price: number;
    confidence?: number;
    extra?: string;
  }): void {
    try {
      this.insertRegimeEventStmt.run(
        data.timestamp,
        data.eventType,
        data.fromState || null,
        data.toState,
        data.price,
        data.confidence || 0,
        data.extra || null,
      );
    } catch (error) {
      console.error('[DB] Erro ao salvar regime event:', error);
    }
  }
}

export const dbStorage = new SQLiteStorage();
