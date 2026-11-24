// token-radar-01 entrypoint (Node 22, standard library only).
// Reads the sealed snapshot, ranks the pre-token protocols by the radar-3
// model, and writes the board, the dashboard's data, and the dossier.
//
//   node main.ts --input /input/snapshot.json
//   MAKEFUN_OUTPUT_DIR=/output node main.ts
//
// The input defaults to /input/snapshot.json and the output to /output (or
// MAKEFUN_OUTPUT_DIR when set). Both runs write the same bytes: the model is
// deterministic, anchored to the snapshot's own as_of date.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from './lib/model.ts';
import type { BoardRow, Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

function flagValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : null;
}

const inputPath = flagValue('--input') ?? '/input/snapshot.json';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snapshot = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
const rows: BoardRow[] = buildBoard(snapshot);

// The dashboard's data: the same rows, compacted to short keys so the whole
// dashboard still fits the dossier's 64 KiB text cap. The dashboard
// regenerates each row's farm steps from these figures (rank tier, main
// chain, category), so the steps it shows are the board's steps.
interface CompactRow {
  s: string;
  n: string;
  r: number;
  v: number;
  t: number;
  c: string | null;
  m: number;
  g: number | null;
  f: number;
  a: number;
  e: number;
  k: number;
  h: number;
  x: string;
}

// Look the snapshot record up once per slug (a map, not a scan per row)
// so the build stays linear even as the snapshot grows.
const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
const compact: CompactRow[] = rows.map((row) => {
  const p = bySlug.get(row.slug) as Snapshot['protocols'][number];
  return {
    s: row.slug,
    n: row.name,
    r: row.rank,
    v: row.implied_value_usd,
    t: row.model.tvl_usd,
    c: row.model.category,
    m: row.model.multiple,
    g: row.model.growth_7d_pct,
    f: row.model.growth_factor,
    a: row.model.age_days,
    e: row.model.age_factor,
    k: row.model.chains,
    h: row.model.chain_factor,
    x: p.chains[0] ?? 'Ethereum',
  };
});

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, 'dashboard'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });

// The page itself, then the data beside it, then the screenshots.
cpSync(join(REPO_ROOT, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
cpSync(join(REPO_ROOT, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows }, null, 2) + '\n', 'utf8');

const dataJs = `// Token Radar data: the ranked board, generated from the sealed snapshot.
// One row per protocol; the dashboard regenerates each row's farm steps from
// its rank, category and main chain, so what it shows is the board's plan.
window.RADAR_DATA = ${JSON.stringify(
  {
    asOf: snapshot.as_of,
    source: snapshot.source,
    floorUsd: snapshot.floor_usd,
    watchlist: snapshot.watchlist,
    rows: compact,
  },
  null,
  0,
)};
`;
writeFileSync(join(outDir, 'dashboard', 'data.js'), dataJs, 'utf8');

// The dossier the judge reads: the dashboard's source plus the screenshots.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

const top = rows[0];
console.log(
  `token-radar: ${rows.length} rows, top ${top?.name} $${top?.implied_value_usd.toLocaleString('en-US')} (rank 1), watchlist ${snapshot.watchlist.length} covered`,
);
console.log(`wrote ${join(outDir, 'board.json')}, ${join(outDir, 'dashboard', 'data.js')}, ${join(outDir, 'dossier.json')}`);
