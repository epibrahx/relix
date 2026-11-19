import {
  Column,
  Relation,
  Schema,
  Table,
  TypeFamily,
  createDeclaredRelation,
  normalizeTypeFamily,
} from './model';

function parseDollarTag(s: string, start: number): number | null {
  if (s[start] !== '$') return null;
  let j = start + 1;
  while (j < s.length) {
    const ch = s[j];
    if (ch === '$') return j + 1 - start;
    if (!/[a-zA-Z0-9_]/.test(ch)) return null;
    j += 1;
  }
  return null;
}

/**
 * Split SQL text into top-level semicolon-terminated statements, respecting strings,
 * quoted identifiers, `--` line comments, `/* *\/` block comments, and Postgres `$$...$$` blocks.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // Line comment --
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        cur += sql[i];
        i += 1;
      }
      continue;
    }

    // Block comment /* ... */
    if (ch === '/' && sql[i + 1] === '*') {
      cur += '/*';
      i += 2;
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          cur += '*/';
          i += 2;
          break;
        }
        cur += sql[i];
        i += 1;
      }
      continue;
    }

    // Single-quoted string or double-quoted identifier or backtick
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      cur += quote;
      i += 1;
      while (i < sql.length) {
        const c = sql[i];
        cur += c;
        i += 1;
        if (c === quote) {
          if (sql[i] === quote) {
            cur += quote;
            i += 1;
          } else {
            break;
          }
        }
      }
      continue;
    }

    // Postgres dollar-quoted block $$...$$
    if (ch === '$') {
      const tagLen = parseDollarTag(sql, i);
      if (tagLen !== null) {
        const tag = sql.slice(i, i + tagLen);
        cur += tag;
        i += tagLen;
        const endIdx = sql.indexOf(tag, i);
        if (endIdx >= 0) {
          cur += sql.slice(i, endIdx + tagLen);
          i = endIdx + tagLen;
        } else {
          cur += sql.slice(i);
          break;
        }
        continue;
      }
    }

    if (ch === ';') {
      const stmt = cur.trim();
      if (stmt.length > 0) out.push(stmt);
      cur = '';
      i += 1;
      continue;
    }

    cur += ch;
    i += 1;
  }

  const tail = cur.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

function stripLeadingComments(stmt: string): string {
  let s = stmt.trim();
  while (s.length > 0) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n');
      if (nl < 0) return '';
      s = s.slice(nl + 1).trim();
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      if (end < 0) return '';
      s = s.slice(end + 2).trim();
    } else {
      break;
    }
  }
  return s;
}

function stripInlineComments(s: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < s.length) {
    const ch = s[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (s[i + 1] === quote) {
          out += s[i + 1];
          i += 2;
          continue;
        }
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '-' && s[i + 1] === '-') {
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function unquoteIdent(raw: string): string {
  const s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith('`') && s.endsWith('`')) ||
    (s.startsWith('[') && s.endsWith(']'))
  ) {
    return s.slice(1, -1).replace(/""/g, '"');
  }
  return s;
}

function unquoteString(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      cur += ch;
      if (ch === quote) {
        if (input[i + 1] === quote) {
          cur += input[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      cur += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      const trimmed = cur.trim();
      if (trimmed) parts.push(trimmed);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) parts.push(tail);
  return parts;
}

function extractParenBlock(s: string, openIdx: number): { inside: string; closeIdx: number } | null {
  if (s[openIdx] !== '(') return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) {
        if (s[i + 1] === quote) {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return { inside: s.slice(openIdx + 1, i), closeIdx: i };
      }
    }
  }
  return null;
}

function parseIdentList(listStr: string): string[] {
  return splitTopLevelCommas(listStr)
    .map((item) => {
      const cleaned = item
        .trim()
        .replace(/\s+(ASC|DESC|NULLS\s+FIRST|NULLS\s+LAST)\b.*$/i, '')
        .trim();
      if (cleaned.includes('(')) return '';
      const parts = cleaned.split('.');
      return unquoteIdent(parts[parts.length - 1]);
    })
    .filter((x) => x.length > 0);
}

function truncatePreview(s: string, maxChars: number): string {
  const collapsed = s.trim().split(/\s+/).join(' ');
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars)}...`;
}

interface PendingFk {
  fromCols: string[];
  foreignTable: string;
  toCols: string[];
}

class SqlSchemaBuilder {
  defaultSchema: string;
  tables = new Map<string, Table>();
  relations: Relation[] = [];
  warnings: string[] = [];
  enumTypes = new Map<string, string[]>();
  domainTypes = new Map<string, TypeFamily>();

  constructor(defaultSchema: string) {
    this.defaultSchema = defaultSchema;
  }

  resolveObjectName(rawName: string): { id: string; schema: string; name: string } {
    const parts: string[] = [];
    let cur = '';
    let quote: string | null = null;
    for (let i = 0; i < rawName.length; i++) {
      const ch = rawName[i];
      if (quote) {
        cur += ch;
        if (ch === quote) {
          if (rawName[i + 1] === quote) {
            cur += rawName[i + 1];
            i += 1;
          } else {
            quote = null;
          }
        }
      } else if (ch === '"' || ch === '`') {
        quote = ch;
        cur += ch;
      } else if (ch === '.') {
        if (cur.trim()) parts.push(unquoteIdent(cur));
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) parts.push(unquoteIdent(cur));

    if (parts.length === 1) {
      return {
        id: `${this.defaultSchema}.${parts[0]}`,
        schema: this.defaultSchema,
        name: parts[0],
      };
    }
    if (parts.length >= 2) {
      const schema = parts[parts.length - 2];
      const name = parts[parts.length - 1];
      return { id: `${schema}.${name}`, schema, name };
    }
    return {
      id: `${this.defaultSchema}.unknown`,
      schema: this.defaultSchema,
      name: 'unknown',
    };
  }

  addForeignKey(
    fromTableId: string,
    fromCols: string[],
    rawForeignTable: string,
    toColsInput: string[],
  ): void {
    const { id: toTableId } = this.resolveObjectName(rawForeignTable);
    let toCols = [...toColsInput];
    if (toCols.length === 0) {
      const targetTbl = this.tables.get(toTableId);
      if (targetTbl) {
        toCols = [...targetTbl.primary_key];
      }
    }
    if (fromCols.length === 0 || toCols.length === 0 || fromCols.length !== toCols.length) {
      this.warnings.push(
        `Foreign key from ${fromTableId} to ${toTableId} could not match columns; skipped.`,
      );
      return;
    }
    this.relations.push(createDeclaredRelation(fromTableId, fromCols, toTableId, toCols));
  }

  applyStatement(rawStmt: string): void {
    const cleaned = stripInlineComments(stripLeadingComments(rawStmt)).trim();
    if (!cleaned) return;

    if (/^CREATE\s+TYPE\b/i.test(cleaned)) {
      this.handleCreateType(cleaned);
      return;
    }
    if (/^CREATE\s+DOMAIN\b/i.test(cleaned)) {
      this.handleCreateDomain(cleaned);
      return;
    }
    if (/^CREATE\s+(?:(?:TEMP|TEMPORARY|UNLOGGED|GLOBAL|LOCAL)\s+)*TABLE\b/i.test(cleaned)) {
      this.handleCreateTable(cleaned);
      return;
    }
    if (/^ALTER\s+TABLE\b/i.test(cleaned)) {
      this.handleAlterTable(cleaned);
      return;
    }
    if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(cleaned)) {
      this.handleCreateIndex(cleaned);
      return;
    }
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:TEMP|TEMPORARY|MATERIALIZED)\s+)*VIEW\b/i.test(cleaned)) {
      this.handleCreateView(cleaned);
      return;
    }
    if (/^COMMENT\s+ON\b/i.test(cleaned)) {
      this.handleComment(cleaned);
      return;
    }

    this.warnings.push(`Ignored non-DDL or unsupported statement: \`${truncatePreview(cleaned, 64)}\``);
  }

  private handleCreateType(stmt: string): void {
    const m = stmt.match(/^CREATE\s+TYPE\s+([^\s]+)\s+AS\s+ENUM\s*\(([^)]+)\)/i);
    if (!m) return;
    const { name } = this.resolveObjectName(m[1]);
    const values = splitTopLevelCommas(m[2]).map((v) => unquoteString(v));
    this.enumTypes.set(name.toLowerCase(), values);
  }

  private handleCreateDomain(stmt: string): void {
    const m = stmt.match(/^CREATE\s+DOMAIN\s+([^\s]+)\s+AS\s+([^\s;]+(?:\([^)]*\))?)/i);
    if (!m) return;
    const { name } = this.resolveObjectName(m[1]);
    const family = normalizeTypeFamily('sqlfile', m[2]);
    this.domainTypes.set(name.toLowerCase(), family);
  }

  private handleCreateTable(stmt: string): void {
    const hdrMatch = stmt.match(
      /^CREATE\s+(?:(?:TEMP|TEMPORARY|UNLOGGED|GLOBAL|LOCAL)\s+)*TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i,
    );
    if (!hdrMatch) {
      this.warnings.push(`Unable to parse CREATE TABLE: \`${truncatePreview(stmt, 72)}\``);
      return;
    }

    const { id: tableId, schema: schemaName, name: tableName } = this.resolveObjectName(
      hdrMatch[1],
    );

    const afterName = stmt.slice(hdrMatch[0].length);
    const partOfMatch = afterName.match(/^\s+PARTITION\s+OF\s+([^\s(]+)/i);
    const partitionOfId = partOfMatch ? this.resolveObjectName(partOfMatch[1]).id : null;

    const searchFrom = hdrMatch[0].length + (partOfMatch ? partOfMatch[0].length : 0);
    const openIdx = stmt.indexOf('(', searchFrom);
    const block = openIdx >= 0 ? extractParenBlock(stmt, openIdx) : null;

    if (!block && !partitionOfId) {
      this.warnings.push(`CREATE TABLE missing column list: \`${truncatePreview(stmt, 72)}\``);
      return;
    }

    const tail = block ? stmt.slice(block.closeIdx + 1) : stmt.slice(searchFrom);
    const tblCommentMatch = tail.match(/\bCOMMENT\s*=?\s*('(?:''|[^'])*')/i);
    const tableComment = tblCommentMatch ? unquoteString(tblCommentMatch[1]) : null;
    const isPartitionParent = /\bPARTITION\s+BY\b/i.test(tail);

    const items = block ? splitTopLevelCommas(block.inside) : [];
    const columns: Column[] = [];
    let primaryKey: string[] = [];
    const uniqueKeys: string[][] = [];
    const pendingFks: PendingFk[] = [];

    for (const rawItem of items) {
      const item = rawItem.trim();
      if (!item) continue;

      if (
        /^(?:CONSTRAINT\s+[^\s]+\s+)?(?:PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|EXCLUDE)\b/i.test(
          item,
        )
      ) {
        const res = this.parseTableConstraint(tableId, item, columns, primaryKey, uniqueKeys, pendingFks);
        primaryKey = res.primaryKey;
        continue;
      }

      const colParsed = this.parseColumnDef(item);
      if (!colParsed) continue;

      if (colParsed.isPk && !primaryKey.includes(colParsed.column.name)) {
        primaryKey.push(colParsed.column.name);
      }
      if (colParsed.isUnique) {
        uniqueKeys.push([colParsed.column.name]);
      }
      if (colParsed.fk) {
        pendingFks.push(colParsed.fk);
      }
      columns.push(colParsed.column);
    }

    // If PARTITION OF without explicit column list, inherit parent columns
    if (columns.length === 0 && partitionOfId) {
      const parentTbl = this.tables.get(partitionOfId);
      if (parentTbl) {
        for (const c of parentTbl.columns) {
          columns.push({ ...c });
        }
        primaryKey = [...parentTbl.primary_key];
      }
    }

    this.tables.set(tableId, {
      id: tableId,
      schema: schemaName,
      name: tableName,
      kind: 'table',
      comment: tableComment,
      is_partition: Boolean(partitionOfId) || isPartitionParent,
      partition_of: partitionOfId,
      columns,
      primary_key: primaryKey,
      unique_keys: uniqueKeys,
      indexes: [],
    });

    for (const fk of pendingFks) {
      this.addForeignKey(tableId, fk.fromCols, fk.foreignTable, fk.toCols);
    }
  }

  private parseColumnDef(
    item: string,
  ): { column: Column; isPk: boolean; isUnique: boolean; fk?: PendingFk } | null {
    const nameMatch = item.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s(]+)\s+([\s\S]+)$/);
    if (!nameMatch) return null;

    const colName = unquoteIdent(nameMatch[1]);
    const rest = nameMatch[2].trim();

    // Split data type from trailing column options.
    const optionBoundary =
      /\b(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|DEFAULT|REFERENCES|CHECK|CONSTRAINT|COLLATE|GENERATED|AUTOINCREMENT|AUTO_INCREMENT|COMMENT)\b/i;

    // Scan top-level (depth 0) for the first option keyword
    let typeEnd = rest.length;
    let depth = 0;
    let quote: string | null = null;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (quote) {
        if (ch === quote) {
          if (rest[i + 1] === quote) i += 1;
          else quote = null;
        }
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '(') {
        depth += 1;
        continue;
      }
      if (ch === ')') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth === 0 && (i === 0 || /\s/.test(rest[i - 1]))) {
        const sub = rest.slice(i);
        const m = sub.match(optionBoundary);
        if (m && m.index === 0) {
          typeEnd = i;
          break;
        }
      }
    }

    const rawType = rest.slice(0, typeEnd).trim().replace(/\s+/g, ' ');
    const opts = rest.slice(typeEnd).trim();
    const baseTypeKey = rawType.split('.').pop()?.replace(/["`]/g, '').toLowerCase() ?? '';
    let typeFamily = normalizeTypeFamily('sqlfile', rawType);
    if (typeFamily === 'other') {
      if (this.enumTypes.has(baseTypeKey)) {
        typeFamily = 'text';
      } else if (this.domainTypes.has(baseTypeKey)) {
        typeFamily = this.domainTypes.get(baseTypeKey)!;
      }
    }

    const isPk = /\bPRIMARY\s+KEY\b/i.test(opts);
    const isUnique = !isPk && /\bUNIQUE\b/i.test(opts);
    const hasNotNull = /\bNOT\s+NULL\b/i.test(opts);

    let defaultVal: string | null = null;
    const defMatch = opts.match(
      /\bDEFAULT\s+((?:'(?:''|[^'])*')|(?:[^\s(]+\([^)]*\))|[^\s,]+)/i,
    );
    if (defMatch) {
      defaultVal = defMatch[1].trim();
    }

    let comment: string | null = null;
    const cmtMatch = opts.match(/\bCOMMENT\s+('(?:''|[^'])*')/i);
    if (cmtMatch) {
      comment = unquoteString(cmtMatch[1]);
    }

    let fk: PendingFk | undefined;
    const refMatch = opts.match(/\bREFERENCES\s+([^\s(]+)(?:\s*\(([^)]*)\))?/i);
    if (refMatch) {
      const foreignTable = refMatch[1];
      const toCols = refMatch[2] ? parseIdentList(refMatch[2]) : [];
      fk = {
        fromCols: [colName],
        foreignTable,
        toCols,
      };
    }

    return {
      column: {
        name: colName,
        data_type: rawType,
        type_family: typeFamily,
        nullable: !hasNotNull && !isPk,
        default: defaultVal,
        comment,
      },
      isPk,
      isUnique,
      fk,
    };
  }

  private parseTableConstraint(
    tableId: string,
    item: string,
    columns: Column[],
    primaryKey: string[],
    uniqueKeys: string[][],
    pendingFks: PendingFk[],
  ): { primaryKey: string[] } {
    const stripped = item.replace(/^CONSTRAINT\s+(?:"[^"]+"|`[^`]+`|[^\s]+)\s+/i, '').trim();

    const pkMatch = stripped.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
    if (pkMatch) {
      const names = parseIdentList(pkMatch[1]);
      for (const name of names) {
        const col = columns.find((c) => c.name === name);
        if (col) col.nullable = false;
      }
      return { primaryKey: names };
    }

    const uqMatch = stripped.match(/^UNIQUE(?:\s+KEY|\s+INDEX)?(?:\s+[^\s(]+)?\s*\(([^)]+)\)/i);
    if (uqMatch) {
      const names = parseIdentList(uqMatch[1]);
      if (
        names.length > 0 &&
        !uniqueKeys.some((u) => u.length === names.length && u.every((v, idx) => v === names[idx]))
      ) {
        uniqueKeys.push(names);
      }
      return { primaryKey };
    }

    const fkMatch = stripped.match(
      /^FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([^\s(]+)(?:\s*\(([^)]*)\))?/i,
    );
    if (fkMatch) {
      const fromCols = parseIdentList(fkMatch[1]);
      const foreignTable = fkMatch[2];
      const toCols = fkMatch[3] ? parseIdentList(fkMatch[3]) : [];
      pendingFks.push({ fromCols, foreignTable, toCols });
      return { primaryKey };
    }

    this.warnings.push(`Skipped table constraint (CHECK/EXCLUDE) on ${tableId}`);
    return { primaryKey };
  }

  private handleAlterTable(stmt: string): void {
    const m = stmt.match(/^ALTER\s+TABLE\s+(?:ONLY\s+)?([^\s]+)\s+([\s\S]+)$/i);
    if (!m) {
      this.warnings.push(`Unable to parse ALTER TABLE: \`${truncatePreview(stmt, 72)}\``);
      return;
    }
    const { id: tableId } = this.resolveObjectName(m[1]);
    const ops = splitTopLevelCommas(m[2]);

    for (const rawOp of ops) {
      const op = rawOp.trim();
      const addConstraint = op.match(/^ADD\s+((?:CONSTRAINT\s+[^\s]+\s+)?(?:PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|EXCLUDE)[\s\S]+)$/i);
      if (addConstraint) {
        const tbl = this.tables.get(tableId);
        if (!tbl) {
          this.warnings.push(`ALTER TABLE referenced undefined table ${tableId}`);
          continue;
        }
        const pendingFks: PendingFk[] = [];
        const res = this.parseTableConstraint(
          tableId,
          addConstraint[1],
          tbl.columns,
          tbl.primary_key,
          tbl.unique_keys,
          pendingFks,
        );
        tbl.primary_key = res.primaryKey;
        for (const fk of pendingFks) {
          this.addForeignKey(tableId, fk.fromCols, fk.foreignTable, fk.toCols);
        }
        continue;
      }

      const addCol = op.match(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i);
      if (addCol) {
        const tbl = this.tables.get(tableId);
        if (!tbl) {
          this.warnings.push(`ALTER TABLE ADD COLUMN referenced undefined table ${tableId}`);
          continue;
        }
        const colParsed = this.parseColumnDef(addCol[1]);
        if (colParsed) {
          tbl.columns.push(colParsed.column);
          if (colParsed.isPk && !tbl.primary_key.includes(colParsed.column.name)) {
            tbl.primary_key.push(colParsed.column.name);
          }
          if (colParsed.isUnique) {
            tbl.unique_keys.push([colParsed.column.name]);
          }
          if (colParsed.fk) {
            this.addForeignKey(
              tableId,
              colParsed.fk.fromCols,
              colParsed.fk.foreignTable,
              colParsed.fk.toCols,
            );
          }
        }
        continue;
      }

      this.warnings.push(`Skipped unsupported ALTER TABLE operation on ${tableId}`);
    }
  }

  private handleCreateIndex(stmt: string): void {
    const m = stmt.match(
      /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:([^\s]+)\s+)?ON\s+(?:ONLY\s+)?([^\s(]+)(?:\s+USING\s+[^\s(]+)?\s*\(([^)]+)\)(.*)$/i,
    );
    if (!m) {
      this.warnings.push(`Unable to parse CREATE INDEX: \`${truncatePreview(stmt, 72)}\``);
      return;
    }
    const isUnique = Boolean(m[1]);
    const idxName = m[2] ? unquoteIdent(m[2].split('.').pop() ?? 'unnamed_index') : 'unnamed_index';
    const { id: tableId } = this.resolveObjectName(m[3]);
    const rawColList = m[4];
    const hasWhere = /\bWHERE\b/i.test(m[5] ?? '');

    if (rawColList.includes('(')) {
      this.warnings.push(`Expression index ${idxName} on ${tableId} skipped.`);
      return;
    }
    const cols = parseIdentList(rawColList);
    const tbl = this.tables.get(tableId);
    if (!tbl) {
      this.warnings.push(`CREATE INDEX referenced undefined table ${tableId}`);
      return;
    }

    if (
      isUnique &&
      !hasWhere &&
      cols.length > 0 &&
      !tbl.unique_keys.some((u) => u.length === cols.length && u.every((v, idx) => v === cols[idx]))
    ) {
      tbl.unique_keys.push([...cols]);
    }
    tbl.indexes.push({ name: idxName, columns: cols, unique: isUnique });
  }

  private handleCreateView(stmt: string): void {
    const m = stmt.match(
      /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:TEMP|TEMPORARY|MATERIALIZED)\s+)*VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)(?:\s*\(([^)]+)\))?\s+AS\s+([\s\S]+)$/i,
    );
    if (!m) {
      this.warnings.push(`Unable to parse CREATE VIEW: \`${truncatePreview(stmt, 72)}\``);
      return;
    }

    const { id: viewId, schema: schemaName, name: viewName } = this.resolveObjectName(m[1]);
    const explicitCols = m[2] ? parseIdentList(m[2]) : [];
    const querySql = m[3].trim();
    const columns: Column[] = [];

    if (explicitCols.length > 0) {
      for (const colName of explicitCols) {
        columns.push({
          name: colName,
          data_type: '',
          type_family: 'other',
          nullable: true,
          default: null,
          comment: null,
        });
      }
    } else {
      const selMatch = querySql.match(/^SELECT\s+(?:DISTINCT\s+)?([\s\S]+?)\s+FROM\s+([\s\S]+)/i);
      if (selMatch) {
        const projStr = selMatch[1];
        const fromStr = selMatch[2];

        const aliasToTable = new Map<string, string>();
        const fromTableMatch = fromStr.match(
          /^([^\s,;]+)(?:\s+(?:AS\s+)?(?!WHERE\b|JOIN\b|LEFT\b|RIGHT\b|INNER\b|OUTER\b|GROUP\b|ORDER\b|LIMIT\b)([a-zA-Z_][a-zA-Z0-9_]*))?/i,
        );
        if (fromTableMatch) {
          const { id: tid, name: tname } = this.resolveObjectName(fromTableMatch[1]);
          aliasToTable.set(tname, tid);
          if (fromTableMatch[2]) {
            aliasToTable.set(unquoteIdent(fromTableMatch[2]), tid);
          }
        }

        const joinRegex =
          /\bJOIN\s+([^\s,;]+)(?:\s+(?:AS\s+)?(?!ON\b|USING\b|WHERE\b|JOIN\b|LEFT\b|RIGHT\b|INNER\b|GROUP\b|ORDER\b)([a-zA-Z_][a-zA-Z0-9_]*))?/gi;
        let jm: RegExpExecArray | null;
        while ((jm = joinRegex.exec(fromStr)) !== null) {
          const { id: tid, name: tname } = this.resolveObjectName(jm[1]);
          aliasToTable.set(tname, tid);
          if (jm[2]) {
            aliasToTable.set(unquoteIdent(jm[2]), tid);
          }
        }

        for (const item of splitTopLevelCommas(projStr)) {
          const asMatch = item.match(/^([\s\S]+?)\s+AS\s+("[^"]+"|`[^`]+`|[^\s]+)$/i);
          if (asMatch) {
            const colName = unquoteIdent(asMatch[2]);
            columns.push({
              name: colName,
              data_type: '',
              type_family: 'other',
              nullable: true,
              default: null,
              comment: null,
            });
            continue;
          }
          const compound = item.match(/^([^\s.]+)\.([^\s.]+)$/);
          if (compound) {
            const alias = unquoteIdent(compound[1]);
            const colName = unquoteIdent(compound[2]);
            const [dt, tf] = this.lookupViewCol(aliasToTable, alias, colName);
            columns.push({
              name: colName,
              data_type: dt,
              type_family: tf,
              nullable: true,
              default: null,
              comment: null,
            });
            continue;
          }
          const simple = item.match(/^("[^"]+"|`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*)$/);
          if (simple) {
            const colName = unquoteIdent(simple[1]);
            const [dt, tf] = this.lookupViewCol(aliasToTable, null, colName);
            columns.push({
              name: colName,
              data_type: dt,
              type_family: tf,
              nullable: true,
              default: null,
              comment: null,
            });
          }
        }
      }
    }

    const isMaterialized = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:TEMP|TEMPORARY)\s+)*MATERIALIZED\s+VIEW\b/i.test(
      stmt,
    );

    this.tables.set(viewId, {
      id: viewId,
      schema: schemaName,
      name: viewName,
      kind: isMaterialized ? 'materialized_view' : 'view',
      comment: null,
      columns,
      primary_key: [],
      unique_keys: [],
      indexes: [],
    });
  }

  private lookupViewCol(
    aliasToTable: Map<string, string>,
    alias: string | null,
    colName: string,
  ): [string, TypeFamily] {
    if (alias !== null) {
      const tid = aliasToTable.get(alias);
      if (tid) {
        const tbl = this.tables.get(tid);
        const col = tbl?.columns.find((c) => c.name === colName);
        if (col) return [col.data_type, col.type_family];
      }
    } else {
      for (const tid of aliasToTable.values()) {
        const tbl = this.tables.get(tid);
        const col = tbl?.columns.find((c) => c.name === colName);
        if (col) return [col.data_type, col.type_family];
      }
    }
    return ['', 'other'];
  }

  private handleComment(stmt: string): void {
    const m = stmt.match(
      /^COMMENT\s+ON\s+(TABLE|COLUMN|MATERIALIZED\s+VIEW|VIEW)\s+([^\s]+)\s+IS\s+((?:'(?:''|[^'])*')|NULL)$/i,
    );
    if (!m) {
      this.warnings.push(`Ignored unsupported COMMENT ON statement: \`${truncatePreview(stmt, 64)}\``);
      return;
    }
    const objType = m[1].toUpperCase().replace(/\s+/g, ' ');
    const rawTarget = m[2];
    const comment = m[3].toUpperCase() === 'NULL' ? null : unquoteString(m[3]);

    if (objType === 'TABLE' || objType === 'VIEW' || objType === 'MATERIALIZED VIEW') {
      const { id: tableId } = this.resolveObjectName(rawTarget);
      const tbl = this.tables.get(tableId);
      if (tbl) tbl.comment = comment;
      else this.warnings.push(`COMMENT ON ${objType} referenced undefined object ${tableId}`);
      return;
    }

    const parts = rawTarget.split('.').map((p) => unquoteIdent(p));
    let tableId: string;
    let colName: string;
    if (parts.length === 2) {
      tableId = `${this.defaultSchema}.${parts[0]}`;
      colName = parts[1];
    } else if (parts.length === 3) {
      tableId = `${parts[0]}.${parts[1]}`;
      colName = parts[2];
    } else {
      this.warnings.push(`Unrecognized COMMENT ON COLUMN target: ${rawTarget}`);
      return;
    }

    const tbl = this.tables.get(tableId);
    if (!tbl) {
      this.warnings.push(`COMMENT ON COLUMN referenced undefined table ${tableId}`);
      return;
    }
    const col = tbl.columns.find((c) => c.name === colName);
    if (!col) {
      this.warnings.push(`COMMENT ON COLUMN could not find column ${tableId}.${colName}`);
      return;
    }
    col.comment = comment;
  }

  intoSchema(): Schema {
    const tables = Array.from(this.tables.values());
    for (const tbl of tables) {
      tbl.unique_keys.sort((a, b) => a.join(',').localeCompare(b.join(',')));
      tbl.unique_keys = tbl.unique_keys.filter(
        (u, idx, arr) => idx === 0 || u.join(',') !== arr[idx - 1].join(','),
      );
      tbl.indexes.sort((a, b) => a.name.localeCompare(b.name));
    }
    tables.sort((a, b) => a.id.localeCompare(b.id));

    this.relations.sort((a, b) => a.id.localeCompare(b.id));
    const dedupRelations: Relation[] = [];
    for (const rel of this.relations) {
      if (dedupRelations.length === 0 || dedupRelations[dedupRelations.length - 1].id !== rel.id) {
        dedupRelations.push(rel);
      }
    }

    const warnings = Array.from(new Set(this.warnings)).sort();

    return {
      dialect: 'sqlfile',
      tables,
      relations: dedupRelations,
      warnings,
    };
  }
}

export function parseSqlSchema(sql: string, defaultSchema = 'main'): Schema {
  if (!sql.trim()) {
    throw new Error('SQL content is empty.');
  }

  const builder = new SqlSchemaBuilder(defaultSchema);
  const statements = splitSqlStatements(sql);
  for (const stmt of statements) {
    builder.applyStatement(stmt);
  }

  if (builder.tables.size === 0) {
    throw new Error('No tables or views were parsed from the SQL input.');
  }

  return builder.intoSchema();
}
