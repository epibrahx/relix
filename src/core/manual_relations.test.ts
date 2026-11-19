import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  applyConfigToSchema,
  configAddManualRelation,
  configRemoveManualRelation,
  configUpdateManualRelationNote,
  createDefaultProjectConfig,
} from './config';
import { EXPORT_FORMATS, renderExport } from './export';
import { parseSqlSchema } from './sqlfile';

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures');

test('Track B1: manual relation uses distinct kind=manual, supports note/delete, warns on type mismatch without blocking, and annotates source in all 5 exports', () => {
  const sql = fs.readFileSync(path.join(FIXTURES_DIR, '03_wild_legacy.sql'), 'utf8');
  const schema = parseSqlSchema(sql, 'main');
  assert.equal(schema.relations.length, 0, '03_wild_legacy should have 0 declared FKs');

  const cfg = createDefaultProjectConfig();
  const relId = configAddManualRelation(cfg, {
    from_table: 'main.tbl_orders',
    from_columns: ['customer_id'],
    to_table: 'main.tbl_customers',
    to_columns: ['id'],
    note: '订单下单客户（野生库无外键）',
  });

  applyConfigToSchema(cfg, schema);
  const manualRel = schema.relations.find((r) => r.id === relId);
  assert.ok(manualRel, 'Manual relation must be materialized');
  assert.equal(manualRel.kind, 'manual', 'Must use kind="manual", NOT kind="inferred"');
  assert.equal(manualRel.note, '订单下单客户（野生库无外键）');
  assert.equal(manualRel.missing_target, null);

  // Update note
  configUpdateManualRelationNote(cfg, relId, '更新后的中文备注');
  applyConfigToSchema(cfg, schema);
  assert.equal(schema.relations.find((r) => r.id === relId)?.note, '更新后的中文备注');

  // Verify source annotation in all 5 exports
  for (const fmt of EXPORT_FORMATS) {
    const out = renderExport(schema, cfg, fmt.id);
    if (fmt.id === 'mermaid') {
      assert.ok(out.includes('[manual'), 'Mermaid export must tag manual source');
    } else if (fmt.id === 'markdown') {
      assert.ok(out.includes('[source: manual]'), 'Markdown export must tag manual source');
      assert.ok(out.includes('更新后的中文备注'), 'Markdown export must include manual note');
    } else if (fmt.id === 'svg' || fmt.id === 'html') {
      assert.ok(out.includes('data-source="manual"'), `${fmt.id} must tag manual source`);
    } else if (fmt.id === 'json') {
      const parsed = JSON.parse(out);
      assert.equal(parsed.relations[0].kind, 'manual');
      assert.equal(parsed.relations[0].note, '更新后的中文备注');
    }
  }

  // Delete manual relation
  assert.equal(configRemoveManualRelation(cfg, relId), true);
  applyConfigToSchema(cfg, schema);
  assert.equal(schema.relations.length, 0);
});

test('Track B1: type mismatch warns without blocking, and missing target on reload flags red warning instead of silent drop', () => {
  const sqlV1 = `
    CREATE TABLE users (id INTEGER PRIMARY KEY, code TEXT);
    CREATE TABLE logs (id INTEGER PRIMARY KEY, user_code TEXT, user_ref INTEGER);
  `;
  const schemaV1 = parseSqlSchema(sqlV1, 'main');
  const cfg = createDefaultProjectConfig();

  // Intentional type mismatch: TEXT -> INTEGER (should warn but still create)
  const mismatchId = configAddManualRelation(cfg, {
    from_table: 'main.logs',
    from_columns: ['user_code'],
    to_table: 'main.users',
    to_columns: ['id'],
  });
  applyConfigToSchema(cfg, schemaV1);
  const rel1 = schemaV1.relations.find((r) => r.id === mismatchId);
  assert.ok(rel1);
  assert.equal(rel1.type_mismatch, true, 'Type mismatch should be flagged without blocking');

  // Reload against v2 where column `user_code` was removed
  const sqlV2 = `
    CREATE TABLE users (id INTEGER PRIMARY KEY, code TEXT);
    CREATE TABLE logs (id INTEGER PRIMARY KEY, user_ref INTEGER);
  `;
  const schemaV2 = parseSqlSchema(sqlV2, 'main');
  applyConfigToSchema(cfg, schemaV2);
  const rel2 = schemaV2.relations.find((r) => r.id === mismatchId);
  assert.ok(rel2, 'Missing manual relation must remain visible for red warning rather than silent drop');
  assert.ok(rel2.missing_target?.includes('user_code'));
  assert.ok(schemaV2.warnings.some((w) => w.includes('手动关系失效')));
});
