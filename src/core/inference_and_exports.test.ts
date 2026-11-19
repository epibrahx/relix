import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENABLE_INFERENCE } from './featureFlags';
import { applyConfigToSchema, createDefaultProjectConfig } from './config';
import { EXPORT_FORMATS, renderExport } from './export';
import { DEFAULT_INFER_CONFIG, populateInferredRelations } from './infer';
import { classifyConnectionError, redactConnectionUrl, redactSecrets } from './redact';
import { parseSqlSchema } from './sqlfile';

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

test('Track F: ENABLE_INFERENCE is false by default and all 5 exports contain zero inferred relations', () => {
  assert.equal(ENABLE_INFERENCE, false);

  const sql = readFixture('03_wild_legacy.sql');
  const schema = parseSqlSchema(sql, 'main');
  // Even if someone populated inferred relations, applyConfigToSchema with default flag strips them
  populateInferredRelations(schema, DEFAULT_INFER_CONFIG);
  assert.ok(schema.relations.some((r) => r.kind === 'inferred'));

  const cfg = createDefaultProjectConfig();
  applyConfigToSchema(cfg, schema);
  assert.equal(
    schema.relations.filter((r) => r.kind === 'inferred').length,
    0,
    'applyConfigToSchema must strip inferred relations when ENABLE_INFERENCE is false',
  );

  for (const fmt of EXPORT_FORMATS) {
    const out = renderExport(schema, cfg, fmt.id);
    assert.equal(
      /\[inferred\]|inferred-auto|edge-inferred/i.test(out),
      false,
      `Export format ${fmt.id} must not leak inferred markers when flag is off`,
    );
  }
});

test('Track F3: inference engine still passes golden check when explicitly enabled', () => {
  const sql = readFixture('03_wild_legacy.sql');
  const schema = parseSqlSchema(sql, 'main');
  populateInferredRelations(schema, DEFAULT_INFER_CONFIG);

  const inferred = schema.relations.filter((r) => r.kind === 'inferred');
  assert.ok(inferred.length >= 4, `Expected >=4 inferred relations on 03_wild_legacy, got ${inferred.length}`);

  const cfg = createDefaultProjectConfig();
  applyConfigToSchema(cfg, schema, { enableInference: true });
  assert.equal(schema.relations.filter((r) => r.kind === 'inferred').length, inferred.length);
});

test('Track A3 & C: edge-case SQL DDL fixture parses enums, domains, views, mviews, partitions, quoted idents, composite PK/FK, no-PK table, and Chinese comments', () => {
  const sql = readFixture('04_edge_cases_cn.sql');
  const schema = parseSqlSchema(sql, 'main');

  const tenant = schema.tables.find((t) => t.id === 'auth.TenantAccount');
  assert.ok(tenant, 'Quoted mixed-case multi-schema table auth.TenantAccount must exist');
  assert.deepEqual(tenant.primary_key, ['TenantID', 'AccountCode']);
  assert.ok(tenant.comment?.includes('多租户主账号表'));

  const orders = schema.tables.find((t) => t.id === 'billing.sales_orders');
  assert.ok(orders, 'Partition parent table billing.sales_orders must exist');
  assert.equal(orders.is_partition, true);
  const statusCol = orders.columns.find((c) => c.name === 'status');
  const amountCol = orders.columns.find((c) => c.name === 'total_amount');
  assert.equal(statusCol?.type_family, 'text', 'Enum column should map to text family');
  assert.equal(amountCol?.type_family, 'numeric', 'Domain column should inherit numeric family');

  const childPart = schema.tables.find((t) => t.id === 'billing.sales_orders_2026');
  assert.ok(childPart, 'Partition child table must exist');
  assert.equal(childPart.partition_of, 'billing.sales_orders');

  const audit = schema.tables.find((t) => t.id === 'billing.audit_events');
  assert.ok(audit, 'No-PK audit table must exist');
  assert.equal(audit.primary_key.length, 0);

  const view = schema.tables.find((t) => t.id === 'billing.v_active_orders');
  assert.equal(view?.kind, 'view');
  assert.ok(view?.comment?.includes('逻辑视图'));

  const mview = schema.tables.find((t) => t.id === 'billing.mv_monthly_revenue');
  assert.equal(mview?.kind, 'materialized_view');
  assert.ok(mview?.comment?.includes('物化视图'));

  const compositeFk = schema.relations.find(
    (r) => r.from_table === 'billing.sales_orders' && r.to_table === 'auth.TenantAccount',
  );
  assert.ok(compositeFk, 'Composite FK from billing.sales_orders to auth.TenantAccount must exist');
  assert.deepEqual(compositeFk.from_columns, ['tenant_id', 'account_code']);
  assert.deepEqual(compositeFk.to_columns, ['TenantID', 'AccountCode']);
});

test('Track A4 & E2: Chinook public fixture exports cleanly in all 5 formats with comments & legend', () => {
  const sql = readFixture('05_chinook_subset.sql');
  const schema = parseSqlSchema(sql, 'main');
  assert.equal(schema.tables.length, 11);
  assert.ok(schema.relations.length >= 11);

  const cfg = createDefaultProjectConfig();
  for (const fmt of EXPORT_FORMATS) {
    const out = renderExport(schema, cfg, fmt.id, { theme: 'dark' });
    assert.ok(out.length > 200, `Expected non-empty ${fmt.id} export for Chinook`);
    if (fmt.id === 'svg' || fmt.id === 'html') {
      assert.ok(out.includes('声明外键'), `${fmt.id} must include legend`);
      assert.ok(out.includes('手动关系'), `${fmt.id} must include manual legend entry`);
    }
  }
});

test('Track A5: error classification returns clear Chinese messages and strictly redacts passwords & tokens', () => {
  const secretPass = 'SuperSecretPgPass_987!';
  const secretTok = 'shpat_live_secret_token_999';

  const uriRedacted = redactConnectionUrl(`postgres://readonly:${secretPass}@db.prod.local:5432/shop?sslmode=require`);
  assert.equal(uriRedacted.includes(secretPass), false);
  assert.ok(uriRedacted.includes('readonly:***@db.prod.local'));

  const kvRedacted = redactConnectionUrl(`host=localhost port=5432 user=ro password='${secretPass}' dbname=app`);
  assert.equal(kvRedacted.includes(secretPass), false);

  const tokRedacted = redactSecrets(`Authorization: Bearer ${secretTok} failed`, [secretTok]);
  assert.equal(tokRedacted.includes(secretTok), false);

  const cases: Array<[unknown, Parameters<typeof classifyConnectionError>[1], string]> = [
    [new Error(`password authentication failed for postgres://u:${secretPass}@h/d`), {}, '凭据无效'],
    [new Error('permission denied for table pg_class'), { status: 403 }, '权限不足'],
    [new Error('self signed certificate in certificate chain'), {}, '证书校验失败'],
    [new Error('server does not support SSL (sslmode mismatch)'), {}, 'sslmode'],
    [new Error('Too Many Requests'), { status: 429 }, '限流'],
    [new Error('No tables found in empty database'), {}, '目标库为空'],
    [new TypeError('Failed to fetch'), { provider: 'saleor', isBrowserCorsLikely: true }, 'CORS'],
    [new Error('connect ECONNREFUSED 127.0.0.1:5432'), {}, '无法连接'],
  ];

  for (const [err, ctx, expectedSubstr] of cases) {
    const msg = classifyConnectionError(err, { ...ctx, secretTokens: [secretPass, secretTok] });
    assert.ok(msg.includes(expectedSubstr), `Expected "${msg}" to include "${expectedSubstr}"`);
    assert.equal(msg.includes(secretPass), false, 'Password leaked into error message');
    assert.equal(msg.includes(secretTok), false, 'Token leaked into error message');
  }
});
