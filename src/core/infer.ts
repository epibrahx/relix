import {
  Column,
  Relation,
  Schema,
  Table,
  computeRelationId,
  formatTypeFamilyLabel,
} from './model';
import {
  DEFAULT_MORPHOLOGY_CONFIG,
  MorphologyConfig,
  extractFkStem,
  normalizeTableStem,
  stemsMatch,
} from './morphology';

export interface InferConfig {
  morphology: MorphologyConfig;
}

export const DEFAULT_INFER_CONFIG: InferConfig = {
  morphology: DEFAULT_MORPHOLOGY_CONFIG,
};

export interface RelationCandidate {
  to_table: string;
  to_column: string;
  evidence: string[];
  self_reference: boolean;
}

export interface AmbiguousColumn {
  from_table: string;
  from_column: string;
  candidates: RelationCandidate[];
}

export interface InferOutput {
  inferred: Relation[];
  ambiguous: AmbiguousColumn[];
}

function sameSchema(a: string, b: string): boolean {
  return a.split('.')[0] === b.split('.')[0];
}

function matchingSingleKeys(targetTable: Table, col: Column): Array<[string, boolean]> {
  if (targetTable.primary_key.length === 1) {
    const pkName = targetTable.primary_key[0];
    const pkCol = targetTable.columns.find((c) => c.name === pkName);
    if (pkCol && pkCol.type_family === col.type_family) {
      return [[pkName, true]];
    }
  }

  const uniqueMatches: Array<[string, boolean]> = [];
  for (const uk of targetTable.unique_keys) {
    if (uk.length === 1) {
      const ukName = uk[0];
      const ukCol = targetTable.columns.find((c) => c.name === ukName);
      if (ukCol && ukCol.type_family === col.type_family) {
        uniqueMatches.push([ukName, false]);
      }
    }
  }
  return uniqueMatches;
}

function findCandidates(
  fromTable: Table,
  col: Column,
  stem: string,
  baseTables: Array<[Table, string]>,
): RelationCandidate[] {
  let candidates: RelationCandidate[] = [];
  const isParentAlias = stem === 'parent';

  for (const [targetTable, targetStem] of baseTables) {
    const isSelf = targetTable.id === fromTable.id;
    if (isSelf && fromTable.primary_key.includes(col.name)) {
      continue;
    }

    const nameMatched = stemsMatch(stem, targetStem);
    const selfParentMatched = isSelf && isParentAlias;
    if (!nameMatched && !selfParentMatched) {
      continue;
    }

    const matchedKeys = matchingSingleKeys(targetTable, col);
    for (const [keyColName, isPk] of matchedKeys) {
      const keyLabel = isPk ? 'PK' : 'UNIQUE key';
      const evidence = [
        `Column ${col.name} matches table ${targetTable.name}; both ${formatTypeFamilyLabel(col.type_family)}; target ${keyColName} is ${keyLabel}`,
      ];
      if (isSelf) {
        evidence.push('self_reference');
      }
      candidates.push({
        to_table: targetTable.id,
        to_column: keyColName,
        evidence,
        self_reference: isSelf,
      });
    }
  }

  if (isParentAlias && candidates.some((c) => !c.self_reference)) {
    candidates = candidates.filter((c) => !c.self_reference);
  }

  if (candidates.length > 1 && candidates.some((c) => sameSchema(fromTable.id, c.to_table))) {
    const sameSchemaOnly = candidates.filter((c) => sameSchema(fromTable.id, c.to_table));
    if (sameSchemaOnly.length > 0) {
      candidates = sameSchemaOnly;
    }
  }

  return candidates;
}

/**
 * Deterministic implicit relation inference (rules C1–C4) matching `relix_core::infer_relations`.
 */
export function inferRelations(
  schema: Schema,
  config: InferConfig = DEFAULT_INFER_CONFIG,
): InferOutput {
  const inferred: Relation[] = [];
  const ambiguous: AmbiguousColumn[] = [];

  const declaredCols = new Set<string>();
  for (const rel of schema.relations) {
    if (rel.kind === 'declared') {
      for (const col of rel.from_columns) {
        declaredCols.add(`${rel.from_table}::${col}`);
      }
    }
  }

  const baseTables: Array<[Table, string]> = schema.tables
    .filter((t) => t.kind === 'table')
    .map((t) => [t, normalizeTableStem(t.name, config.morphology.tablePrefixes)]);

  for (const fromTable of schema.tables) {
    if (fromTable.kind !== 'table') continue;

    for (const col of fromTable.columns) {
      if (col.type_family === 'other') continue;
      if (declaredCols.has(`${fromTable.id}::${col.name}`)) continue;
      if (fromTable.primary_key.length === 1 && fromTable.primary_key[0] === col.name) {
        continue;
      }

      const stemInfo = extractFkStem(col.name);
      if (!stemInfo) continue;

      const rawCandidates = findCandidates(fromTable, col, stemInfo.stem, baseTables);

      rawCandidates.sort((a, b) => {
        const tCmp = a.to_table.localeCompare(b.to_table);
        if (tCmp !== 0) return tCmp;
        return a.to_column.localeCompare(b.to_column);
      });

      const candidates: RelationCandidate[] = [];
      for (const c of rawCandidates) {
        const last = candidates[candidates.length - 1];
        if (!last || last.to_table !== c.to_table || last.to_column !== c.to_column) {
          candidates.push(c);
        }
      }

      if (candidates.length === 1) {
        const c = candidates[0];
        const fromCols = [col.name];
        const toCols = [c.to_column];
        const id = computeRelationId(fromTable.id, fromCols, c.to_table, toCols);
        inferred.push({
          id,
          from_table: fromTable.id,
          from_columns: fromCols,
          to_table: c.to_table,
          to_columns: toCols,
          kind: 'inferred',
          status: 'auto',
          evidence: c.evidence,
        });
      } else if (candidates.length > 1) {
        ambiguous.push({
          from_table: fromTable.id,
          from_column: col.name,
          candidates,
        });
      }
    }
  }

  inferred.sort((a, b) => a.id.localeCompare(b.id));
  return { inferred, ambiguous };
}

export function populateInferredRelations(
  schema: Schema,
  config: InferConfig = DEFAULT_INFER_CONFIG,
): AmbiguousColumn[] {
  schema.relations = schema.relations.filter(
    (r) => r.kind === 'declared' || r.status === 'confirmed',
  );
  const out = inferRelations(schema, config);
  const existingIds = new Set(schema.relations.map((r) => r.id));
  for (const rel of out.inferred) {
    if (!existingIds.has(rel.id)) {
      schema.relations.push(rel);
      existingIds.add(rel.id);
    }
  }
  schema.relations.sort((a, b) => a.id.localeCompare(b.id));
  return out.ambiguous;
}
