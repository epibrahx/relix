import { ProjectConfig } from '../config';
import { Schema } from '../model';

export type BuiltinFixtureId =
  | 'ecommerce'
  | 'blog_cms'
  | 'wild_legacy'
  | 'edge_cases_cn'
  | 'chinook';

export type GraphQLProvider = 'saleor' | 'shopify';

export type SourceSpec =
  | { type: 'builtin'; fixture: BuiltinFixtureId }
  | { type: 'bench'; tables: number }
  | { type: 'sql'; label: string; sql: string }
  | { type: 'json'; label: string; json: string }
  | { type: 'graphql_snapshot'; provider: GraphQLProvider }
  | { type: 'graphql_sdl'; provider: GraphQLProvider; label: string; content: string }
  | {
      type: 'graphql_live';
      provider: GraphQLProvider;
      endpoint: string;
      token?: string;
      apiVersion?: string;
      label?: string;
    };

export interface LoadedSource {
  schema: Schema;
  rawSql: string | null;
  rawFormat?: 'sql' | 'graphql' | 'json';
  sourceLabel: string;
  sourceKey: string;
  config: ProjectConfig;
  spec: SourceSpec;
  snapshotVersion?: string;
  snapshotTime?: string;
}

/**
 * Track G1: Unified SchemaSource abstraction so relational DDL/DB loaders
 * and remote GraphQL schema connectors produce the exact same RELIX `Schema`.
 */
export interface SchemaSource {
  readonly id: string;
  readonly provider: 'sql' | 'json' | 'bench' | 'saleor' | 'shopify';
  readonly readsBusinessData: false;
  load(): Promise<LoadedSource> | LoadedSource;
}
