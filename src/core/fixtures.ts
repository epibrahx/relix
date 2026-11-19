import ecommerceSql from '../../fixtures/01_ecommerce.sql?raw';
import blogCmsSql from '../../fixtures/02_blog_cms.sql?raw';
import wildLegacySql from '../../fixtures/03_wild_legacy.sql?raw';
import edgeCasesCnSql from '../../fixtures/04_edge_cases_cn.sql?raw';
import chinookSql from '../../fixtures/05_chinook_subset.sql?raw';

import { createDefaultProjectConfig, loadPersistedConfig } from './config';
import { ENABLE_INFERENCE } from './featureFlags';
import { DEFAULT_INFER_CONFIG, populateInferredRelations } from './infer';
import { Schema } from './model';
import { generateSyntheticSchema } from './schemagen';
import { parseSqlSchema } from './sqlfile';
import {
  createSaleorSnapshotSource,
  fetchSaleorLiveSource,
  loadSaleorFromContent,
} from './sources/saleor';
import {
  createShopifySnapshotSource,
  fetchShopifyLiveSource,
  loadShopifyFromContent,
} from './sources/shopify';
import { BuiltinFixtureId, LoadedSource, SourceSpec } from './sources/types';

export type { BuiltinFixtureId, LoadedSource, SourceSpec };

export interface BuiltinFixtureInfo {
  id: BuiltinFixtureId;
  title: string;
  subtitle: string;
  sql: string;
}

export const BUILTIN_FIXTURES: BuiltinFixtureInfo[] = [
  { id: 'ecommerce', title: '01 电商示例', subtitle: '声明外键完整', sql: ecommerceSql },
  { id: 'blog_cms', title: '02 博客 CMS', subtitle: '多表内容模型', sql: blogCmsSql },
  { id: 'wild_legacy', title: '03 无外键库', subtitle: '适合手动连线', sql: wildLegacySql },
  { id: 'edge_cases_cn', title: '04 边界与中文', subtitle: '枚举/视图/分区', sql: edgeCasesCnSql },
  { id: 'chinook', title: '05 Chinook', subtitle: 'MIT 公开示例库', sql: chinookSql },
];

export function loadSource(
  spec: SourceSpec,
  options?: { enableInference?: boolean },
): LoadedSource {
  const inferenceOn = options?.enableInference ?? ENABLE_INFERENCE;

  if (spec.type === 'builtin') {
    const info = BUILTIN_FIXTURES.find((f) => f.id === spec.fixture) ?? BUILTIN_FIXTURES[0];
    const schema = parseSqlSchema(info.sql, 'main');
    if (inferenceOn) {
      populateInferredRelations(schema, DEFAULT_INFER_CONFIG);
    }
    const sourceKey = `fixture:${info.id}`;
    return {
      schema,
      rawSql: info.sql,
      rawFormat: 'sql',
      sourceLabel: `示例：${info.title}`,
      sourceKey,
      config: loadPersistedConfig(sourceKey),
      spec,
    };
  }

  if (spec.type === 'bench') {
    const schema = generateSyntheticSchema(spec.tables, 10, 1.4, 20261117n);
    const sourceKey = `bench:${spec.tables}`;
    return {
      schema,
      rawSql: null,
      sourceLabel: `压测合成库 (${spec.tables} 张表)`,
      sourceKey,
      config: createDefaultProjectConfig(),
      spec,
    };
  }

  if (spec.type === 'sql') {
    const schema = parseSqlSchema(spec.sql, 'main');
    if (inferenceOn) {
      populateInferredRelations(schema, DEFAULT_INFER_CONFIG);
    }
    const sourceKey = `sql:${spec.label}`;
    return {
      schema,
      rawSql: spec.sql,
      rawFormat: 'sql',
      sourceLabel: spec.label,
      sourceKey,
      config: loadPersistedConfig(sourceKey),
      spec,
    };
  }

  if (spec.type === 'graphql_snapshot') {
    return spec.provider === 'saleor'
      ? createSaleorSnapshotSource().load() as LoadedSource
      : createShopifySnapshotSource().load() as LoadedSource;
  }

  if (spec.type === 'graphql_sdl') {
    return spec.provider === 'saleor'
      ? loadSaleorFromContent(spec.content, spec.label)
      : loadShopifyFromContent(spec.content, spec.label);
  }

  if (spec.type === 'graphql_live') {
    throw new Error('在线 GraphQL 内省请使用异步加载流程。');
  }

  // JSON schema
  let parsed: Schema;
  try {
    parsed = JSON.parse(spec.json) as Schema;
  } catch (err) {
    throw new Error(`Schema JSON 解析失败：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || !Array.isArray(parsed.tables) || !Array.isArray(parsed.relations)) {
    throw new Error('JSON 文档必须包含 "tables" 和 "relations" 数组。');
  }
  if (!Array.isArray(parsed.warnings)) {
    parsed.warnings = [];
  }
  if (inferenceOn) {
    populateInferredRelations(parsed, DEFAULT_INFER_CONFIG);
  } else {
    parsed.relations = parsed.relations.filter((r) => r.kind !== 'inferred');
  }
  const sourceKey = `json:${spec.label}`;
  return {
    schema: parsed,
    rawSql: spec.json,
    rawFormat: 'json',
    sourceLabel: spec.label,
    sourceKey,
    config: loadPersistedConfig(sourceKey),
    spec,
  };
}

export async function loadSourceAsync(
  spec: SourceSpec,
  options?: { enableInference?: boolean },
): Promise<LoadedSource> {
  if (spec.type === 'graphql_live') {
    if (spec.provider === 'saleor') {
      return fetchSaleorLiveSource(spec.endpoint, spec.token);
    }
    return fetchShopifyLiveSource({
      endpoint: spec.endpoint,
      accessToken: spec.token,
      apiVersion: spec.apiVersion,
    });
  }
  return loadSource(spec, options);
}
