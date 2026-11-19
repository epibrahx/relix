export type Dialect = 'postgres' | 'sqlite' | 'sqlfile' | 'graphql';

export type TypeFamily =
  | 'integer'
  | 'text'
  | 'uuid'
  | 'numeric'
  | 'bool'
  | 'timestamp'
  | 'json'
  | 'binary'
  | 'other';

export type TableKind = 'table' | 'view' | 'materialized_view';

export type RelationKind = 'declared' | 'manual' | 'inferred';

export type RelationStatus = 'auto' | 'confirmed' | 'rejected';

export interface Column {
  name: string;
  data_type: string;
  type_family: TypeFamily;
  nullable: boolean;
  default?: string | null;
  comment?: string | null;
}

export interface Index {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface Table {
  id: string;
  schema: string;
  name: string;
  kind: TableKind;
  comment?: string | null;
  domain?: string | null;
  is_partition?: boolean;
  partition_of?: string | null;
  columns: Column[];
  primary_key: string[];
  unique_keys: string[][];
  indexes: Index[];
}

export interface Relation {
  id: string;
  from_table: string;
  from_columns: string[];
  to_table: string;
  to_columns: string[];
  kind: RelationKind;
  status: RelationStatus;
  evidence: string[];
  note?: string | null;
  missing_target?: string | null;
  type_mismatch?: boolean;
}

export interface SchemaSourceMeta {
  provider?: 'saleor' | 'shopify' | 'sql' | 'json' | 'bench';
  version?: string;
  fetched_at?: string;
  read_only_note?: string;
}

export interface Schema {
  dialect: Dialect;
  tables: Table[];
  relations: Relation[];
  warnings: string[];
  source_meta?: SchemaSourceMeta;
}

export function createEmptySchema(dialect: Dialect): Schema {
  return {
    dialect,
    tables: [],
    relations: [],
    warnings: [],
  };
}

export function tableById(schema: Schema, id: string): Table | undefined {
  return schema.tables.find((t) => t.id === id);
}

const FNV_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV_PRIME = 0x0000000001000000000000000000013bn;
const MASK_128 = (1n << 128n) - 1n;
const utf8Encoder = new TextEncoder();

function u64LeBytes(value: number): Uint8Array {
  const buf = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

/**
 * Deterministic 128-bit FNV-1a relation ID matching `relix_core::Relation::compute_id`.
 */
export function computeRelationId(
  fromTable: string,
  fromColumns: string[],
  toTable: string,
  toColumns: string[],
): string {
  let hash = FNV_OFFSET;

  const feedBytes = (bytes: Uint8Array) => {
    const lenBytes = u64LeBytes(bytes.length);
    for (let i = 0; i < lenBytes.length; i++) {
      hash ^= BigInt(lenBytes[i]);
      hash = (hash * FNV_PRIME) & MASK_128;
    }
    for (let i = 0; i < bytes.length; i++) {
      hash ^= BigInt(bytes[i]);
      hash = (hash * FNV_PRIME) & MASK_128;
    }
  };

  feedBytes(utf8Encoder.encode(fromTable));
  feedBytes(u64LeBytes(fromColumns.length));
  for (const col of fromColumns) {
    feedBytes(utf8Encoder.encode(col));
  }
  feedBytes(utf8Encoder.encode(toTable));
  feedBytes(u64LeBytes(toColumns.length));
  for (const col of toColumns) {
    feedBytes(utf8Encoder.encode(col));
  }

  return `rel_${hash.toString(16).padStart(32, '0')}`;
}

export function createDeclaredRelation(
  fromTable: string,
  fromColumns: string[],
  toTable: string,
  toColumns: string[],
  evidence: string[] = [],
): Relation {
  return {
    id: computeRelationId(fromTable, fromColumns, toTable, toColumns),
    from_table: fromTable,
    from_columns: [...fromColumns],
    to_table: toTable,
    to_columns: [...toColumns],
    kind: 'declared',
    status: 'auto',
    evidence: [...evidence],
  };
}

export function createManualRelation(
  fromTable: string,
  fromColumns: string[],
  toTable: string,
  toColumns: string[],
  note?: string | null,
  options?: { missingTarget?: string | null; typeMismatch?: boolean },
): Relation {
  return {
    id: computeRelationId(fromTable, fromColumns, toTable, toColumns),
    from_table: fromTable,
    from_columns: [...fromColumns],
    to_table: toTable,
    to_columns: [...toColumns],
    kind: 'manual',
    status: 'confirmed',
    evidence: [note?.trim() ? `手动关系：${note.trim()}` : '用户手动创建的关系'],
    note: note?.trim() || null,
    missing_target: options?.missingTarget ?? null,
    type_mismatch: options?.typeMismatch ?? false,
  };
}

function stripParens(s: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out;
}

function collapseWhitespace(s: string): string {
  return s.trim().split(/\s+/).join(' ');
}

function sqliteAffinityFallback(lowerBase: string): TypeFamily {
  if (lowerBase.includes('int')) return 'integer';
  if (lowerBase.includes('char') || lowerBase.includes('clob') || lowerBase.includes('text')) {
    return 'text';
  }
  if (lowerBase.includes('blob')) return 'binary';
  if (
    lowerBase.includes('real') ||
    lowerBase.includes('floa') ||
    lowerBase.includes('doub') ||
    lowerBase.includes('num') ||
    lowerBase.includes('dec')
  ) {
    return 'numeric';
  }
  return 'other';
}

const INTEGER_TYPES = new Set([
  'int',
  'int2',
  'int4',
  'int8',
  'integer',
  'smallint',
  'bigint',
  'tinyint',
  'mediumint',
  'serial',
  'bigserial',
  'smallserial',
  'serial2',
  'serial4',
  'serial8',
  'int32',
  'int64',
  'rowid',
  'unsignedint64',
]);

const TEXT_TYPES = new Set([
  'text',
  'varchar',
  'character varying',
  'char',
  'character',
  'bpchar',
  'nvarchar',
  'nchar',
  'clob',
  'citext',
  'name',
  'tinytext',
  'mediumtext',
  'longtext',
  'string',
  'id',
  'url',
  'html',
  'color',
  'arn',
]);

const NUMERIC_TYPES = new Set([
  'numeric',
  'decimal',
  'dec',
  'real',
  'float',
  'float4',
  'float8',
  'double',
  'double precision',
  'money',
  'smallmoney',
  'number',
  'positivedecimal',
  'weightscalar',
]);

const TIMESTAMP_TYPES = new Set([
  'timestamp',
  'timestamptz',
  'timestamp with time zone',
  'timestamp without time zone',
  'datetime',
  'datetime2',
  'smalldatetime',
  'date',
  'time',
  'timetz',
  'time with time zone',
  'time without time zone',
]);

const BINARY_TYPES = new Set([
  'bytea',
  'blob',
  'binary',
  'varbinary',
  'tinyblob',
  'mediumblob',
  'longblob',
]);

export function normalizeTypeFamily(dialect: Dialect, rawType: string): TypeFamily {
  const trimmed = rawType.trim();
  if (!trimmed) return 'other';

  const lower = trimmed.toLowerCase();
  if (dialect === 'graphql') {
    const unwrapped = lower.replace(/[\[\]!]/g, '').trim();
    if (INTEGER_TYPES.has(unwrapped)) return 'integer';
    if (TEXT_TYPES.has(unwrapped)) return 'text';
    if (unwrapped === 'uuid') return 'uuid';
    if (NUMERIC_TYPES.has(unwrapped)) return 'numeric';
    if (unwrapped === 'boolean' || unwrapped === 'bool') return 'bool';
    if (TIMESTAMP_TYPES.has(unwrapped) || unwrapped === 'utcoffset') return 'timestamp';
    if (unwrapped === 'json' || unwrapped === 'jsonstring' || unwrapped === 'metadata') {
      return 'json';
    }
    return 'other';
  }

  if (
    lower.endsWith('[]') ||
    lower.includes(' array') ||
    (dialect === 'postgres' && lower.startsWith('_'))
  ) {
    return 'other';
  }

  const withoutParens = stripParens(lower);
  const collapsed = collapseWhitespace(withoutParens);
  const dotIdx = collapsed.lastIndexOf('.');
  let base = (dotIdx >= 0 ? collapsed.slice(dotIdx + 1) : collapsed).trim();

  if (base.endsWith(' unsigned')) {
    base = base.slice(0, -' unsigned'.length).trim();
  } else if (base.endsWith(' signed')) {
    base = base.slice(0, -' signed'.length).trim();
  }

  if (INTEGER_TYPES.has(base)) return 'integer';
  if (TEXT_TYPES.has(base)) return 'text';
  if (base === 'uuid' || base === 'uniqueidentifier') return 'uuid';
  if (NUMERIC_TYPES.has(base)) return 'numeric';
  if (base === 'bool' || base === 'boolean') return 'bool';
  if (TIMESTAMP_TYPES.has(base)) return 'timestamp';
  if (base === 'json' || base === 'jsonb') return 'json';
  if (BINARY_TYPES.has(base)) return 'binary';

  if (dialect === 'sqlite') {
    return sqliteAffinityFallback(base);
  }
  return 'other';
}

export function formatTypeFamilyLabel(tf: TypeFamily): string {
  switch (tf) {
    case 'integer':
      return 'Integer';
    case 'text':
      return 'Text';
    case 'uuid':
      return 'Uuid';
    case 'numeric':
      return 'Numeric';
    case 'bool':
      return 'Bool';
    case 'timestamp':
      return 'Timestamp';
    case 'json':
      return 'Json';
    case 'binary':
      return 'Binary';
    default:
      return 'Other';
  }
}

export function cloneSchema(schema: Schema): Schema {
  return {
    dialect: schema.dialect,
    tables: schema.tables.map((t) => ({
      ...t,
      columns: t.columns.map((c) => ({ ...c })),
      primary_key: [...t.primary_key],
      unique_keys: t.unique_keys.map((u) => [...u]),
      indexes: t.indexes.map((ix) => ({ ...ix, columns: [...ix.columns] })),
    })),
    relations: schema.relations.map((r) => ({
      ...r,
      from_columns: [...r.from_columns],
      to_columns: [...r.to_columns],
      evidence: [...r.evidence],
    })),
    warnings: [...schema.warnings],
    source_meta: schema.source_meta ? { ...schema.source_meta } : undefined,
  };
}
