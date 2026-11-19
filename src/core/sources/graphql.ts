import {
  Column,
  Relation,
  Schema,
  Table,
  createDeclaredRelation,
  normalizeTypeFamily,
} from '../model';
import { classifyConnectionError, redactSecrets } from '../redact';
import { GraphQLProvider } from './types';

export interface GraphQLParseOptions {
  provider: GraphQLProvider;
  schemaName?: string;
  version?: string;
  fetchedAt?: string;
}

interface ParsedField {
  name: string;
  rawType: string;
  baseType: string;
  isList: boolean;
  nullable: boolean;
  description: string | null;
}

interface ParsedObjectType {
  name: string;
  kind: 'OBJECT' | 'INTERFACE' | 'UNION' | 'ENUM' | 'SCALAR' | 'INPUT_OBJECT';
  description: string | null;
  domain: string | null;
  fields: ParsedField[];
  enumValues?: string[];
  possibleTypes?: string[];
}

export const GRAPHQL_INTROSPECTION_QUERY = `
query RelixSchemaIntrospection {
  __schema {
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
      enumValues(includeDeprecated: true) {
        name
      }
      possibleTypes {
        name
      }
    }
  }
}
`.trim();

const ROOT_AND_SYSTEM_NAMES = new Set([
  'Query',
  'Mutation',
  'Subscription',
  'PageInfo',
  'Node',
  'ObjectWithMetadata',
  'Event',
  'HasMetafields',
  'LegacyInteroperability',
]);

const NON_ENTITY_SUFFIXES = [
  'Input',
  'FilterInput',
  'SortingInput',
  'WhereInput',
  'OrderBy',
  'OrderDirection',
  'Payload',
  'Error',
  'BulkDelete',
  'BulkCreate',
  'BulkUpdate',
  'Event',
  'Subscription',
  'UserError',
  'Mutation',
];

const BUILTIN_SCALARS = new Set(['ID', 'String', 'Int', 'Float', 'Boolean']);

function stripWrapperType(rawType: string): {
  baseType: string;
  isList: boolean;
  nullable: boolean;
} {
  const trimmed = rawType.trim();
  const nullable = !trimmed.endsWith('!');
  const isList = trimmed.includes('[');
  const baseType = trimmed.replace(/[\[\]!\s]/g, '');
  return { baseType, isList, nullable };
}

function normalizeDescription(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const cleaned = desc
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function isConnectionTypeName(name: string): boolean {
  return name.endsWith('CountableConnection') || name.endsWith('Connection');
}

function isEdgeTypeName(name: string): boolean {
  return name.endsWith('CountableEdge') || name.endsWith('Edge');
}

function isNonEntityObjectName(name: string): boolean {
  if (name.startsWith('__')) return true;
  if (ROOT_AND_SYSTEM_NAMES.has(name)) return true;
  if (isConnectionTypeName(name) || isEdgeTypeName(name)) return true;
  if (NON_ENTITY_SUFFIXES.some((s) => name.endsWith(s) && name !== s)) return true;
  return false;
}

/**
 * Parse GraphQL SDL text (`type`, `interface`, `enum`, `scalar`, `input`, `union`)
 * preserving block/line descriptions and `@doc(category: "...")` directives.
 */
function parseSdlTypes(sdl: string): ParsedObjectType[] {
  const results: ParsedObjectType[] = [];
  const len = sdl.length;
  let i = 0;

  const skipWsAndComments = () => {
    while (i < len) {
      const ch = sdl[i];
      if (/\s/.test(ch) || ch === ',') {
        i += 1;
        continue;
      }
      if (ch === '#') {
        while (i < len && sdl[i] !== '\n') i += 1;
        continue;
      }
      break;
    }
  };

  const readString = (): string => {
    if (sdl.slice(i, i + 3) === '"""') {
      i += 3;
      const start = i;
      while (i < len && sdl.slice(i, i + 3) !== '"""') {
        if (sdl[i] === '\\' && sdl.slice(i + 1, i + 4) === '"""') {
          i += 4;
          continue;
        }
        i += 1;
      }
      const val = sdl.slice(start, i);
      if (sdl.slice(i, i + 3) === '"""') i += 3;
      return val;
    }
    if (sdl[i] === '"') {
      i += 1;
      let out = '';
      while (i < len && sdl[i] !== '"') {
        if (sdl[i] === '\\' && i + 1 < len) {
          out += sdl[i + 1];
          i += 2;
          continue;
        }
        out += sdl[i];
        i += 1;
      }
      if (sdl[i] === '"') i += 1;
      return out;
    }
    return '';
  };

  const readIdent = (): string => {
    const start = i;
    while (i < len && /[A-Za-z0-9_]/.test(sdl[i])) i += 1;
    return sdl.slice(start, i);
  };

  const skipBalanced = (openChar: string, closeChar: string): string => {
    if (sdl[i] !== openChar) return '';
    const start = i;
    let depth = 0;
    while (i < len) {
      if (sdl.slice(i, i + 3) === '"""' || sdl[i] === '"') {
        readString();
        continue;
      }
      if (sdl[i] === '#') {
        while (i < len && sdl[i] !== '\n') i += 1;
        continue;
      }
      if (sdl[i] === openChar) depth += 1;
      else if (sdl[i] === closeChar) {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          return sdl.slice(start, i);
        }
      }
      i += 1;
    }
    return sdl.slice(start, i);
  };

  const readDirectives = (): string | null => {
    let category: string | null = null;
    while (i < len) {
      skipWsAndComments();
      if (sdl[i] !== '@') break;
      i += 1;
      const dirName = readIdent();
      skipWsAndComments();
      let args = '';
      if (sdl[i] === '(') {
        args = skipBalanced('(', ')');
      }
      if (dirName === 'doc' || dirName === 'domain' || dirName === 'category') {
        const m = args.match(/category\s*:\s*"([^"]+)"/) ?? args.match(/name\s*:\s*"([^"]+)"/);
        if (m) category = m[1].trim();
      }
    }
    return category;
  };

  const parseFieldsBlock = (body: string): ParsedField[] => {
    const fields: ParsedField[] = [];
    let j = 0;
    const blen = body.length;

    const bSkip = () => {
      while (j < blen) {
        const ch = body[j];
        if (/\s/.test(ch) || ch === ',') {
          j += 1;
          continue;
        }
        if (ch === '#') {
          while (j < blen && body[j] !== '\n') j += 1;
          continue;
        }
        break;
      }
    };

    const bReadStr = (): string => {
      if (body.slice(j, j + 3) === '"""') {
        j += 3;
        const start = j;
        while (j < blen && body.slice(j, j + 3) !== '"""') j += 1;
        const val = body.slice(start, j);
        if (body.slice(j, j + 3) === '"""') j += 3;
        return val;
      }
      if (body[j] === '"') {
        j += 1;
        let out = '';
        while (j < blen && body[j] !== '"') {
          if (body[j] === '\\' && j + 1 < blen) {
            out += body[j + 1];
            j += 2;
          } else {
            out += body[j];
            j += 1;
          }
        }
        if (body[j] === '"') j += 1;
        return out;
      }
      return '';
    };

    const bSkipParens = () => {
      if (body[j] !== '(') return;
      let depth = 0;
      while (j < blen) {
        if (body.slice(j, j + 3) === '"""' || body[j] === '"') {
          bReadStr();
          continue;
        }
        if (body[j] === '#') {
          while (j < blen && body[j] !== '\n') j += 1;
          continue;
        }
        if (body[j] === '(') depth += 1;
        else if (body[j] === ')') {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            return;
          }
        }
        j += 1;
      }
    };

    while (j < blen) {
      bSkip();
      if (j >= blen) break;

      let desc: string | null = null;
      if (body.slice(j, j + 3) === '"""' || body[j] === '"') {
        desc = normalizeDescription(bReadStr());
        bSkip();
      }
      if (j >= blen) break;

      const nameStart = j;
      while (j < blen && /[A-Za-z0-9_]/.test(body[j])) j += 1;
      const fname = body.slice(nameStart, j);
      if (!fname) {
        j += 1;
        continue;
      }

      bSkip();
      if (body[j] === '(') {
        bSkipParens();
        bSkip();
      }

      if (body[j] !== ':') {
        while (j < blen && body[j] !== '\n') j += 1;
        continue;
      }
      j += 1; // skip ':'
      bSkip();

      const typeStart = j;
      while (j < blen && /[A-Za-z0-9_\[\]!]/.test(body[j])) j += 1;
      const rawType = body.slice(typeStart, j).trim();

      // Skip trailing directives on field (e.g. @deprecated(reason: "..."))
      bSkip();
      while (j < blen && body[j] === '@') {
        j += 1;
        while (j < blen && /[A-Za-z0-9_]/.test(body[j])) j += 1;
        bSkip();
        if (body[j] === '(') {
          bSkipParens();
          bSkip();
        }
      }

      if (rawType) {
        const { baseType, isList, nullable } = stripWrapperType(rawType);
        fields.push({
          name: fname,
          rawType,
          baseType,
          isList,
          nullable,
          description: desc,
        });
      }
    }

    return fields;
  };

  while (i < len) {
    skipWsAndComments();
    if (i >= len) break;

    let description: string | null = null;
    if (sdl.slice(i, i + 3) === '"""' || sdl[i] === '"') {
      description = normalizeDescription(readString());
      skipWsAndComments();
    }
    if (i >= len) break;

    let kw = readIdent();
    if (kw === 'extend') {
      skipWsAndComments();
      kw = readIdent();
    }

    if (kw === 'schema' || kw === 'directive') {
      // Skip schema/directive definitions
      while (i < len && sdl[i] !== '{' && sdl[i] !== '\n') i += 1;
      if (sdl[i] === '{') skipBalanced('{', '}');
      continue;
    }

    skipWsAndComments();
    const typeName = readIdent();
    if (!typeName) {
      i += 1;
      continue;
    }

    if (kw === 'scalar') {
      readDirectives();
      results.push({
        name: typeName,
        kind: 'SCALAR',
        description,
        domain: null,
        fields: [],
      });
      continue;
    }

    if (kw === 'union') {
      const domain = readDirectives();
      skipWsAndComments();
      const possibleTypes: string[] = [];
      if (sdl[i] === '=') {
        i += 1;
        while (i < len) {
          skipWsAndComments();
          if (sdl[i] === '|') {
            i += 1;
            continue;
          }
          const save = i;
          const member = readIdent();
          if (
            !member ||
            ['type', 'interface', 'enum', 'input', 'scalar', 'union', 'extend', 'directive'].includes(
              member,
            )
          ) {
            i = save;
            break;
          }
          possibleTypes.push(member);
          skipWsAndComments();
          if (sdl[i] !== '|') break;
        }
      }
      results.push({
        name: typeName,
        kind: 'UNION',
        description,
        domain,
        fields: [],
        possibleTypes,
      });
      continue;
    }

    if (kw === 'enum') {
      const domain = readDirectives();
      skipWsAndComments();
      const enumValues: string[] = [];
      if (sdl[i] === '{') {
        const block = skipBalanced('{', '}');
        const inner = block.slice(1, -1);
        const matches = inner.match(/\b[A-Z][A-Z0-9_]*\b/g);
        if (matches) enumValues.push(...matches);
      }
      results.push({
        name: typeName,
        kind: 'ENUM',
        description,
        domain,
        fields: [],
        enumValues,
      });
      continue;
    }

    if (kw === 'type' || kw === 'interface' || kw === 'input') {
      // Optional implements clause
      skipWsAndComments();
      if (sdl.slice(i, i + 10).match(/^implements\b/)) {
        i += 10;
        while (i < len && sdl[i] !== '{' && sdl[i] !== '@') i += 1;
      }
      const domain = readDirectives();
      skipWsAndComments();
      let fields: ParsedField[] = [];
      if (sdl[i] === '{') {
        const block = skipBalanced('{', '}');
        fields = parseFieldsBlock(block.slice(1, -1));
      }
      const kindMap: Record<string, ParsedObjectType['kind']> = {
        type: 'OBJECT',
        interface: 'INTERFACE',
        input: 'INPUT_OBJECT',
      };
      results.push({
        name: typeName,
        kind: kindMap[kw],
        description,
        domain,
        fields,
      });
      continue;
    }

    // Unknown token, advance safely
    i += 1;
  }

  return results;
}

interface IntrospectionTypeRef {
  kind: string;
  name?: string | null;
  ofType?: IntrospectionTypeRef | null;
}

interface IntrospectionField {
  name: string;
  description?: string | null;
  type: IntrospectionTypeRef;
}

interface IntrospectionType {
  kind: string;
  name: string;
  description?: string | null;
  fields?: IntrospectionField[] | null;
  enumValues?: Array<{ name: string }> | null;
  possibleTypes?: Array<{ name: string }> | null;
}

function formatIntrospectionType(ref: IntrospectionTypeRef): string {
  if (ref.kind === 'NON_NULL' && ref.ofType) {
    return `${formatIntrospectionType(ref.ofType)}!`;
  }
  if (ref.kind === 'LIST' && ref.ofType) {
    return `[${formatIntrospectionType(ref.ofType)}]`;
  }
  return ref.name ?? 'String';
}

function parseIntrospectionJsonTypes(rawJson: string): ParsedObjectType[] {
  const parsed = JSON.parse(rawJson) as {
    data?: { __schema?: { types?: IntrospectionType[] } };
    __schema?: { types?: IntrospectionType[] };
  };
  const types = parsed?.data?.__schema?.types ?? parsed?.__schema?.types;
  if (!Array.isArray(types)) {
    throw new Error('JSON 中未找到 GraphQL Introspection `__schema.types` 结构。');
  }

  const out: ParsedObjectType[] = [];
  for (const t of types) {
    if (!t || !t.name || t.name.startsWith('__')) continue;
    const kind = t.kind as ParsedObjectType['kind'];
    if (!['OBJECT', 'INTERFACE', 'UNION', 'ENUM', 'SCALAR', 'INPUT_OBJECT'].includes(kind)) {
      continue;
    }
    const fields: ParsedField[] = (t.fields ?? []).map((f) => {
      const rawType = formatIntrospectionType(f.type);
      const { baseType, isList, nullable } = stripWrapperType(rawType);
      return {
        name: f.name,
        rawType,
        baseType,
        isList,
        nullable,
        description: normalizeDescription(f.description),
      };
    });
    out.push({
      name: t.name,
      kind,
      description: normalizeDescription(t.description),
      domain: null,
      fields,
      enumValues: t.enumValues?.map((e) => e.name),
      possibleTypes: t.possibleTypes?.map((p) => p.name),
    });
  }
  return out;
}

/**
 * Infer a domain group name for Shopify/Saleor types when `@doc(category)` is absent.
 */
function inferGraphQLDomain(typeName: string, provider: GraphQLProvider): string {
  const lower = typeName.toLowerCase();
  if (
    lower.includes('product') ||
    lower.includes('variant') ||
    lower.includes('category') ||
    lower.includes('collection') ||
    lower.includes('media') ||
    lower.includes('attribute')
  ) {
    return 'catalog';
  }
  if (
    lower.includes('order') ||
    lower.includes('lineitem') ||
    lower.includes('checkout') ||
    lower.includes('draftorder') ||
    lower.includes('cart')
  ) {
    return 'orders';
  }
  if (
    lower.includes('warehouse') ||
    lower.includes('stock') ||
    lower.includes('allocation') ||
    lower.includes('inventory') ||
    lower.includes('location') ||
    lower.includes('fulfillment') ||
    lower.includes('shipping')
  ) {
    return 'inventory';
  }
  if (
    lower.includes('payment') ||
    lower.includes('transaction') ||
    lower.includes('discount') ||
    lower.includes('voucher') ||
    lower.includes('giftcard') ||
    lower.includes('tax') ||
    lower.includes('price')
  ) {
    return 'billing';
  }
  if (
    lower.includes('user') ||
    lower.includes('customer') ||
    lower.includes('address') ||
    lower.includes('account')
  ) {
    return 'customers';
  }
  if (lower.includes('channel') || lower.includes('market') || lower.includes('shop')) {
    return 'channels';
  }
  return provider;
}

/**
 * Resolve `*CountableConnection` / `*Connection` -> `edges` -> `node` (or `nodes`)
 * to the underlying target entity type name.
 */
function buildConnectionTargetMap(typeMap: Map<string, ParsedObjectType>): Map<string, string> {
  const connToTarget = new Map<string, string>();
  for (const [name, t] of typeMap.entries()) {
    if (t.kind !== 'OBJECT' || !isConnectionTypeName(name)) continue;

    // 1. Direct `nodes: [Target!]` shortcut (Shopify & some Relay schemas)
    const nodesField = t.fields.find((f) => f.name === 'nodes');
    if (nodesField && nodesField.baseType && !isNonEntityObjectName(nodesField.baseType)) {
      connToTarget.set(name, nodesField.baseType);
      continue;
    }

    // 2. Standard Relay `edges: [TargetEdge!]` -> `node: Target!`
    const edgesField = t.fields.find((f) => f.name === 'edges');
    if (edgesField) {
      const edgeType = typeMap.get(edgesField.baseType);
      const nodeField = edgeType?.fields.find((f) => f.name === 'node');
      if (nodeField && nodeField.baseType && !isNonEntityObjectName(nodeField.baseType)) {
        connToTarget.set(name, nodeField.baseType);
      }
    }
  }
  return connToTarget;
}

/**
 * Track G1–G3: Convert GraphQL SDL or Introspection JSON into a standard RELIX `Schema`.
 */
export function parseGraphQLSchema(rawContent: string, options: GraphQLParseOptions): Schema {
  const trimmed = rawContent.trim();
  if (!trimmed) {
    throw new Error('GraphQL Schema 内容为空。');
  }

  const parsedTypes = trimmed.startsWith('{')
    ? parseIntrospectionJsonTypes(trimmed)
    : parseSdlTypes(trimmed);

  if (parsedTypes.length === 0) {
    throw new Error('未能从输入中解析出任何 GraphQL 类型，请确认格式为 SDL (.graphql) 或 Introspection JSON。');
  }

  const typeMap = new Map<string, ParsedObjectType>();
  for (const t of parsedTypes) {
    typeMap.set(t.name, t);
  }

  const scalarOrEnumSet = new Set<string>(BUILTIN_SCALARS);
  for (const t of parsedTypes) {
    if (t.kind === 'SCALAR' || t.kind === 'ENUM') {
      scalarOrEnumSet.add(t.name);
    }
  }

  const connectionTargetMap = buildConnectionTargetMap(typeMap);
  const schemaName = options.schemaName ?? options.provider;

  // Entity object types that become RELIX tables
  const entityTypes = parsedTypes.filter(
    (t) => t.kind === 'OBJECT' && !isNonEntityObjectName(t.name) && t.fields.length > 0,
  );
  const entitySet = new Set(entityTypes.map((t) => t.name));

  const tables: Table[] = [];
  const relations: Relation[] = [];
  const warnings: string[] = [];

  for (const obj of entityTypes) {
    const tableId = `${schemaName}.${obj.name}`;
    const columns: Column[] = [];
    const primaryKey: string[] = [];
    const uniqueKeys: string[][] = [];

    for (const f of obj.fields) {
      // 1. Folded Connection field (`*CountableConnection` / `*Connection`)
      const connTarget = connectionTargetMap.get(f.baseType);
      if (connTarget && entitySet.has(connTarget)) {
        const targetId = `${schemaName}.${connTarget}`;
        const targetObj = typeMap.get(connTarget);
        const targetPk = targetObj?.fields.some((tf) => tf.name === 'id')
          ? 'id'
          : targetObj?.fields[0]?.name ?? 'id';

        columns.push({
          name: f.name,
          data_type: `[${connTarget}]`,
          type_family: 'other',
          nullable: f.nullable,
          default: null,
          comment: f.description
            ? `${f.description}（Connection 折叠为 1:N 关系）`
            : `Connection 折叠为 1:N → ${connTarget}`,
        });

        relations.push(
          createDeclaredRelation(tableId, [f.name], targetId, [targetPk], [
            `GraphQL Connection 折叠：${obj.name}.${f.name} (${f.baseType} → edges.node) → ${connTarget}`,
          ]),
        );
        continue;
      }

      // 2. Direct object reference or list of entity objects
      if (entitySet.has(f.baseType)) {
        const targetId = `${schemaName}.${f.baseType}`;
        const targetObj = typeMap.get(f.baseType);
        const targetPk = targetObj?.fields.some((tf) => tf.name === 'id')
          ? 'id'
          : targetObj?.fields[0]?.name ?? 'id';

        columns.push({
          name: f.name,
          data_type: f.rawType,
          type_family: 'other',
          nullable: f.nullable,
          default: null,
          comment: f.description,
        });

        relations.push(
          createDeclaredRelation(tableId, [f.name], targetId, [targetPk], [
            `GraphQL 字段引用：${obj.name}.${f.name}: ${f.rawType}`,
          ]),
        );
        continue;
      }

      // 3. Scalar / Enum / Value-Object field -> Column
      const targetType = typeMap.get(f.baseType);
      const isEnum = targetType?.kind === 'ENUM';
      const enumHint =
        isEnum && targetType.enumValues && targetType.enumValues.length > 0
          ? `枚举值：${targetType.enumValues.slice(0, 6).join(', ')}${targetType.enumValues.length > 6 ? '…' : ''}`
          : null;
      const combinedComment = [f.description, enumHint].filter(Boolean).join(' · ') || null;

      const isIdField = f.name === 'id' || (f.baseType === 'ID' && primaryKey.length === 0);
      if (isIdField && !primaryKey.includes(f.name)) {
        primaryKey.push(f.name);
      }
      if ((f.name === 'slug' || f.name === 'handle' || f.name === 'sku' || f.name === 'email') && !isIdField) {
        uniqueKeys.push([f.name]);
      }

      columns.push({
        name: f.name,
        data_type: f.rawType,
        type_family: isEnum
          ? 'text'
          : scalarOrEnumSet.has(f.baseType)
            ? normalizeTypeFamily('graphql', f.rawType)
            : 'json',
        nullable: f.nullable,
        default: null,
        comment: combinedComment,
      });
    }

    const domain = obj.domain
      ? obj.domain.toLowerCase().replace(/\s+/g, '_')
      : inferGraphQLDomain(obj.name, options.provider);

    tables.push({
      id: tableId,
      schema: schemaName,
      name: obj.name,
      kind: 'table',
      comment: obj.description,
      domain,
      columns,
      primary_key: primaryKey,
      unique_keys: uniqueKeys,
      indexes: [],
    });
  }

  tables.sort((a, b) => a.id.localeCompare(b.id));

  // Deduplicate relations by deterministic ID
  relations.sort((a, b) => a.id.localeCompare(b.id));
  const dedupedRelations: Relation[] = [];
  for (const r of relations) {
    if (dedupedRelations.length === 0 || dedupedRelations[dedupedRelations.length - 1].id !== r.id) {
      dedupedRelations.push(r);
    }
  }

  const foldedCount = connectionTargetMap.size;
  if (foldedCount > 0) {
    warnings.push(
      `已自动折叠 ${foldedCount} 个 GraphQL Connection 包装类型，仅展示核心业务实体与实体间关系。`,
    );
  }

  return {
    dialect: 'graphql',
    tables,
    relations: dedupedRelations,
    warnings,
    source_meta: {
      provider: options.provider,
      version: options.version,
      fetched_at: options.fetchedAt ?? new Date().toISOString().slice(0, 10),
      read_only_note: '仅读取 GraphQL Schema 元数据，不查询任何业务数据行',
    },
  };
}

export interface LiveIntrospectionOptions {
  provider: GraphQLProvider;
  endpoint: string;
  headers?: Record<string, string>;
  secretTokens?: string[];
  version?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Execute a strictly read-only GraphQL Introspection query (`__schema`).
 * Credentials/tokens remain in memory for the single request and are never persisted or echoed.
 */
export async function fetchGraphQLIntrospection(
  options: LiveIntrospectionOptions,
): Promise<{ schema: Schema; rawJson: string }> {
  const endpoint = options.endpoint.trim();
  if (!endpoint || !/^https?:\/\//i.test(endpoint)) {
    throw new Error('请输入有效的 GraphQL HTTP(S) 端点地址。');
  }

  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers ?? {}),
  };

  let resp: Response;
  try {
    resp = await fetchFn(endpoint, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({ query: GRAPHQL_INTROSPECTION_QUERY }),
    });
  } catch (err) {
    throw new Error(
      classifyConnectionError(err, {
        provider: options.provider,
        secretTokens: options.secretTokens,
        isBrowserCorsLikely: true,
      }),
    );
  }

  if (!resp.ok) {
    let bodySnippet = '';
    try {
      bodySnippet = redactSecrets((await resp.text()).slice(0, 200), options.secretTokens);
    } catch {
      // ignore body read error
    }
    throw new Error(
      classifyConnectionError(
        new Error(`HTTP ${resp.status} ${resp.statusText}${bodySnippet ? `: ${bodySnippet}` : ''}`),
        {
          provider: options.provider,
          status: resp.status,
          secretTokens: options.secretTokens,
        },
      ),
    );
  }

  const text = await resp.text();
  let parsed: { errors?: Array<{ message?: string }>; data?: { __schema?: unknown } };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('端点返回的不是合法的 JSON 响应，请确认地址是否为 GraphQL 端点。');
  }

  if (parsed.errors && parsed.errors.length > 0 && !parsed.data?.__schema) {
    const msg = parsed.errors.map((e) => e.message ?? 'GraphQL error').join('; ');
    throw new Error(
      classifyConnectionError(new Error(msg), {
        provider: options.provider,
        secretTokens: options.secretTokens,
      }),
    );
  }

  const schema = parseGraphQLSchema(text, {
    provider: options.provider,
    version: options.version ?? 'live-introspection',
    fetchedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  });

  return { schema, rawJson: text };
}
