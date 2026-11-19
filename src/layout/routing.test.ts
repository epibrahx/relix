import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createDefaultProjectConfig } from '../core/config';
import { generateSyntheticSchema } from '../core/schemagen';
import { parseSqlSchema } from '../core/sqlfile';
import {
  computeDensityTableHeight,
  computeReloadDiff,
  countEdgeCardCrossings,
  getColumnAnchorY,
  routeOrthogonalEdge,
} from './routing';
import { DEFAULT_LAYOUT_CONFIG, groupedSugiyamaLayout, sugiyamaLayout } from './sugiyama';

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures');

test('Track D1: obstacle-avoiding orthogonal routing achieves 0 segments crossing unrelated cards on fixtures 01–05 and 100-table benchmark', () => {
  const schemas = [
    parseSqlSchema(fs.readFileSync(path.join(FIXTURES_DIR, '01_ecommerce.sql'), 'utf8'), 'main'),
    parseSqlSchema(fs.readFileSync(path.join(FIXTURES_DIR, '02_blog_cms.sql'), 'utf8'), 'main'),
    parseSqlSchema(fs.readFileSync(path.join(FIXTURES_DIR, '04_edge_cases_cn.sql'), 'utf8'), 'main'),
    parseSqlSchema(fs.readFileSync(path.join(FIXTURES_DIR, '05_chinook_subset.sql'), 'utf8'), 'main'),
    generateSyntheticSchema(100, 10, 1.4, 20261117n),
  ];

  for (const schema of schemas) {
    const layout = sugiyamaLayout(schema, DEFAULT_LAYOUT_CONFIG);
    const tableMap = new Map(schema.tables.map((t) => [t.id, t]));
    const allEntries = Object.entries(layout.nodes);

    let totalCrossings = 0;
    schema.relations.forEach((rel, idx) => {
      const fb = layout.nodes[rel.from_table];
      const tb = layout.nodes[rel.to_table];
      if (!fb || !tb) return;

      const fy = getColumnAnchorY(
        tableMap.get(rel.from_table),
        fb,
        rel.from_columns[0],
        'standard',
        false,
      );
      const ty = getColumnAnchorY(
        tableMap.get(rel.to_table),
        tb,
        rel.to_columns[0],
        'standard',
        false,
      );
      const unrelated = allEntries
        .filter(([id]) => id !== rel.from_table && id !== rel.to_table)
        .map(([, b]) => b);

      const routed = routeOrthogonalEdge(fb, tb, fy, ty, unrelated, idx);
      totalCrossings += countEdgeCardCrossings(routed.points, unrelated);
    });

    assert.equal(totalCrossings, 0, 'Routed orthogonal edges must have 0 crossings over unrelated cards');
  }
});

test('Track D2 & D5: column anchor Y tracks exact column rows and falls back to header in compact mode', () => {
  const schema = parseSqlSchema(
    `CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, status TEXT, total NUMERIC, note TEXT);`,
    'main',
  );
  const tbl = schema.tables[0];
  const box = {
    x: 100,
    y: 200,
    width: 240,
    height: computeDensityTableHeight(tbl, 'standard', false),
  };

  const yCol0 = getColumnAnchorY(tbl, box, 'id', 'standard', false);
  const yCol1 = getColumnAnchorY(tbl, box, 'user_id', 'standard', false);
  const yHidden = getColumnAnchorY(tbl, box, 'note', 'standard', false);
  const yExpanded = getColumnAnchorY(tbl, box, 'note', 'detailed', true);
  const yCompact = getColumnAnchorY(tbl, box, 'user_id', 'compact', false);

  assert.ok(yCol1 > yCol0, 'Second column anchor must sit below first column');
  assert.equal(yCol1 - yCol0, DEFAULT_LAYOUT_CONFIG.rowHeight);
  assert.equal(yHidden, box.y + DEFAULT_LAYOUT_CONFIG.headerHeight * 0.5, 'Hidden column falls back to header');
  assert.ok(yExpanded > yCol1, 'Detailed density anchors to exact 5th column row');
  assert.ok(yCompact < yCol0, 'Compact density anchors to card header');
});

test('Track D3: Reload keeps existing table coordinates unchanged and tags added/changed/removed items', () => {
  const prevSchema = parseSqlSchema(
    `
    CREATE TABLE users (id INT PRIMARY KEY, email TEXT);
    CREATE TABLE legacy_temp (id INT PRIMARY KEY);
    `,
    'main',
  );
  const nextSchema = parseSqlSchema(
    `
    CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(255), phone TEXT);
    CREATE TABLE orders (id INT PRIMARY KEY, user_id INT REFERENCES users(id));
    `,
    'main',
  );

  const prevPositions = {
    'main.users': { x: 420, y: 180 },
    'main.legacy_temp': { x: 90, y: 90 },
  };
  const cfg = createDefaultProjectConfig();
  const baseLayout = sugiyamaLayout(nextSchema, DEFAULT_LAYOUT_CONFIG);

  const diff = computeReloadDiff(prevSchema, nextSchema, prevPositions, baseLayout.nodes, cfg);

  assert.deepEqual(diff.mergedPositions['main.users'], { x: 420, y: 180 }, 'Existing table coordinate must stay intact');
  assert.ok(diff.newTableIds.has('main.orders'), 'New table orders must be marked NEW');
  assert.ok(diff.mergedPositions['main.orders'], 'New table must receive a neighbor-adjacent position');
  assert.deepEqual(diff.removedTableIds, ['main.legacy_temp']);
  assert.ok(diff.changedColumns['main.users']?.has('email'), 'Type-changed column must be marked');
  assert.ok(diff.changedColumns['main.users']?.has('phone'), 'Added column must be marked');
});

test('Track D4: groupedSugiyamaLayout packs multi-domain schemas into non-overlapping containers', () => {
  const schema = parseSqlSchema(
    fs.readFileSync(path.join(FIXTURES_DIR, '04_edge_cases_cn.sql'), 'utf8'),
    'main',
  );
  const groupsMap: Record<string, string> = {};
  for (const t of schema.tables) {
    groupsMap[t.id] = t.schema;
  }
  const layout = groupedSugiyamaLayout(schema, groupsMap, DEFAULT_LAYOUT_CONFIG);

  // Compute container boxes per group (pad 18, header 28)
  const byGroup = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
  for (const t of schema.tables) {
    const g = groupsMap[t.id];
    const b = layout.nodes[t.id];
    assert.ok(b, `Expected layout box for ${t.id}`);
    const cur = byGroup.get(g) ?? { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    cur.x1 = Math.min(cur.x1, b.x - 18);
    cur.y1 = Math.min(cur.y1, b.y - 46);
    cur.x2 = Math.max(cur.x2, b.x + b.width + 18);
    cur.y2 = Math.max(cur.y2, b.y + b.height + 18);
    byGroup.set(g, cur);
  }

  const rects = Array.from(byGroup.entries());
  assert.ok(rects.length >= 2, 'Should have multiple domain containers');
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const [gA, a] = rects[i];
      const [gB, b] = rects[j];
      const overlaps = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
      assert.equal(overlaps, false, `Containers ${gA} and ${gB} must not overlap`);
    }
  }
});
