import { db, type SourceRow } from '../db.js';
import { DEFAULT_TTL_HOURS } from '../config.js';
import { refreshSource } from './source.js';

const TICK_MS = 5 * 60 * 1000; // every 5 min

export function startScheduler(): void {
  setTimeout(tick, 10_000); // first run shortly after boot
}

async function tick(): Promise<void> {
  try {
    const rows = db
      .prepare(`SELECT * FROM sources WHERE state IN ('trial','active')`)
      .all() as SourceRow[];
    const now = Date.now();
    for (const s of rows) {
      const ttlHours = s.ttl_hours ?? DEFAULT_TTL_HOURS;
      const due = !s.last_fetched || now - s.last_fetched >= ttlHours * 3_600_000;
      if (!due) continue;
      try {
        await refreshSource(s.id);
      } catch (e) {
        // swallow per-source errors so one bad source doesn't stall the loop
        const msg = e instanceof Error ? e.message : String(e);
        db.prepare('UPDATE sources SET last_error = ? WHERE id = ?').run(msg, s.id);
      }
    }
  } finally {
    setTimeout(tick, TICK_MS);
  }
}
