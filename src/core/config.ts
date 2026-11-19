import { ENABLE_INFERENCE } from './featureFlags';
import { Schema, computeRelationId, createManualRelation, tableById } from './model';

export interface NodePosition {
  x: number;
  y: number;
}

export interface ViewportState {
  zoom: number;
  pan_x: number;
  pan_y: number;
}

export interface ManualRelation {
  from_table: string;
  from_columns: string[];
  to_table: string;
  to_columns: string[];
  note?: string;
}

export type CardDensity = 'compact' | 'standard' | 'detailed';

export interface ProjectConfig {
  confirmed_relations: string[];
  rejected_relations: string[];
  manual_relations: ManualRelation[];
  table_groups: Record<string, string>;
  collapsed_groups: Record<string, boolean>;
  node_positions: Record<string, NodePosition>;
  viewport: ViewportState;
  card_density?: CardDensity;
}

export function createDefaultProjectConfig(): ProjectConfig {
  return {
    confirmed_relations: [],
    rejected_relations: [],
    manual_relations: [],
    table_groups: {},
    collapsed_groups: {},
    node_positions: {},
    viewport: {
      zoom: 1.0,
      pan_x: 0.0,
      pan_y: 0.0,
    },
    card_density: 'standard',
  };
}

export function cloneProjectConfig(cfg: ProjectConfig): ProjectConfig {
  return {
    confirmed_relations: [...cfg.confirmed_relations],
    rejected_relations: [...cfg.rejected_relations],
    manual_relations: cfg.manual_relations.map((m) => ({
      ...m,
      from_columns: [...m.from_columns],
      to_columns: [...m.to_columns],
    })),
    table_groups: { ...cfg.table_groups },
    collapsed_groups: { ...cfg.collapsed_groups },
    node_positions: Object.fromEntries(
      Object.entries(cfg.node_positions).map(([k, v]) => [k, { ...v }]),
    ),
    viewport: { ...cfg.viewport },
    card_density: cfg.card_density ?? 'standard',
  };
}

export function configConfirmRelation(cfg: ProjectConfig, relationId: string): void {
  cfg.rejected_relations = cfg.rejected_relations.filter((id) => id !== relationId);
  if (!cfg.confirmed_relations.includes(relationId)) {
    cfg.confirmed_relations.push(relationId);
  }
}

export function configRejectRelation(cfg: ProjectConfig, relationId: string): void {
  cfg.confirmed_relations = cfg.confirmed_relations.filter((id) => id !== relationId);
  if (!cfg.rejected_relations.includes(relationId)) {
    cfg.rejected_relations.push(relationId);
  }
}

export function configResetRelation(cfg: ProjectConfig, relationId: string): void {
  cfg.confirmed_relations = cfg.confirmed_relations.filter((id) => id !== relationId);
  cfg.rejected_relations = cfg.rejected_relations.filter((id) => id !== relationId);
}

export function configAddManualRelation(cfg: ProjectConfig, manual: ManualRelation): string {
  const id = computeRelationId(
    manual.from_table,
    manual.from_columns,
    manual.to_table,
    manual.to_columns,
  );
  const existingIdx = cfg.manual_relations.findIndex(
    (m) =>
      computeRelationId(m.from_table, m.from_columns, m.to_table, m.to_columns) === id,
  );
  if (existingIdx >= 0) {
    if (manual.note !== undefined) {
      cfg.manual_relations[existingIdx] = {
        ...cfg.manual_relations[existingIdx],
        note: manual.note,
      };
    }
  } else {
    cfg.manual_relations.push({
      from_table: manual.from_table,
      from_columns: [...manual.from_columns],
      to_table: manual.to_table,
      to_columns: [...manual.to_columns],
      note: manual.note?.trim() || undefined,
    });
  }
  return id;
}

export function configUpdateManualRelationNote(
  cfg: ProjectConfig,
  relationId: string,
  note: string,
): boolean {
  const idx = cfg.manual_relations.findIndex(
    (m) =>
      computeRelationId(m.from_table, m.from_columns, m.to_table, m.to_columns) === relationId,
  );
  if (idx < 0) return false;
  cfg.manual_relations[idx] = {
    ...cfg.manual_relations[idx],
    note: note.trim() || undefined,
  };
  return true;
}

export function configRemoveManualRelation(cfg: ProjectConfig, relationId: string): boolean {
  const before = cfg.manual_relations.length;
  cfg.manual_relations = cfg.manual_relations.filter(
    (m) =>
      computeRelationId(m.from_table, m.from_columns, m.to_table, m.to_columns) !== relationId,
  );
  return cfg.manual_relations.length !== before;
}

export function applyConfigToSchema(
  cfg: ProjectConfig,
  schema: Schema,
  options?: { enableInference?: boolean },
): void {
  const inferenceOn = options?.enableInference ?? ENABLE_INFERENCE;

  if (!inferenceOn) {
    schema.relations = schema.relations.filter((r) => r.kind !== 'inferred');
  } else {
    for (const rel of schema.relations) {
      if (rel.kind !== 'inferred') continue;
      if (cfg.confirmed_relations.includes(rel.id)) {
        rel.status = 'confirmed';
      } else if (cfg.rejected_relations.includes(rel.id)) {
        rel.status = 'rejected';
      } else {
        rel.status = 'auto';
      }
    }
  }

  // Remove previously materialized manual relations before re-applying from config cleanly
  schema.relations = schema.relations.filter((r) => r.kind !== 'manual');

  for (const manual of cfg.manual_relations) {
    const id = computeRelationId(
      manual.from_table,
      manual.from_columns,
      manual.to_table,
      manual.to_columns,
    );
    const existing = schema.relations.find((r) => r.id === id);
    if (existing) {
      if (existing.kind === 'inferred' && inferenceOn) {
        existing.status = 'confirmed';
      }
      continue;
    }

    const fromTbl = tableById(schema, manual.from_table);
    const toTbl = tableById(schema, manual.to_table);
    const missingParts: string[] = [];

    if (!fromTbl) {
      missingParts.push(`源表 ${manual.from_table} 不存在`);
    } else {
      for (const c of manual.from_columns) {
        if (!fromTbl.columns.some((col) => col.name === c)) {
          missingParts.push(`源字段 ${manual.from_table}.${c} 不存在`);
        }
      }
    }

    if (!toTbl) {
      missingParts.push(`目标表 ${manual.to_table} 不存在`);
    } else {
      for (const c of manual.to_columns) {
        if (!toTbl.columns.some((col) => col.name === c)) {
          missingParts.push(`目标字段 ${manual.to_table}.${c} 不存在`);
        }
      }
    }

    let typeMismatch = false;
    if (fromTbl && toTbl && missingParts.length === 0) {
      for (let i = 0; i < Math.min(manual.from_columns.length, manual.to_columns.length); i++) {
        const fc = fromTbl.columns.find((c) => c.name === manual.from_columns[i]);
        const tc = toTbl.columns.find((c) => c.name === manual.to_columns[i]);
        if (
          fc &&
          tc &&
          fc.type_family !== 'other' &&
          tc.type_family !== 'other' &&
          fc.type_family !== tc.type_family
        ) {
          typeMismatch = true;
        }
      }
    }

    const missingTarget = missingParts.length > 0 ? missingParts.join('；') : null;
    if (missingTarget) {
      const warnText = `手动关系失效（${manual.from_table}.${manual.from_columns.join(',')} → ${manual.to_table}.${manual.to_columns.join(',')}）：${missingTarget}`;
      if (!schema.warnings.includes(warnText)) {
        schema.warnings.push(warnText);
      }
    }

    schema.relations.push(
      createManualRelation(
        manual.from_table,
        manual.from_columns,
        manual.to_table,
        manual.to_columns,
        manual.note,
        { missingTarget, typeMismatch },
      ),
    );
  }
}

const STORAGE_PREFIX = 'relix_project_cfg_v2::';

export function loadPersistedConfig(sourceKey: string): ProjectConfig {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return createDefaultProjectConfig();
    }
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${sourceKey}`);
    if (!raw) return createDefaultProjectConfig();
    const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
    return {
      confirmed_relations: Array.isArray(parsed.confirmed_relations)
        ? parsed.confirmed_relations
        : [],
      rejected_relations: Array.isArray(parsed.rejected_relations) ? parsed.rejected_relations : [],
      manual_relations: Array.isArray(parsed.manual_relations)
        ? parsed.manual_relations.map((m) => ({
            from_table: m.from_table,
            from_columns: Array.isArray(m.from_columns) ? [...m.from_columns] : [],
            to_table: m.to_table,
            to_columns: Array.isArray(m.to_columns) ? [...m.to_columns] : [],
            note: typeof m.note === 'string' && m.note.trim() ? m.note.trim() : undefined,
          }))
        : [],
      table_groups: parsed.table_groups ?? {},
      collapsed_groups: parsed.collapsed_groups ?? {},
      node_positions: parsed.node_positions ?? {},
      viewport: {
        zoom: parsed.viewport?.zoom ?? 1.0,
        pan_x: parsed.viewport?.pan_x ?? 0.0,
        pan_y: parsed.viewport?.pan_y ?? 0.0,
      },
      card_density:
        parsed.card_density === 'compact' ||
        parsed.card_density === 'standard' ||
        parsed.card_density === 'detailed'
          ? parsed.card_density
          : 'standard',
    };
  } catch {
    return createDefaultProjectConfig();
  }
}

export function savePersistedConfig(sourceKey: string, cfg: ProjectConfig): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    // Persist ONLY safe metadata (table/column names, positions, groups, notes) — never tokens/credentials.
    const safeCfg: ProjectConfig = {
      confirmed_relations: cfg.confirmed_relations,
      rejected_relations: cfg.rejected_relations,
      manual_relations: cfg.manual_relations.map((m) => ({
        from_table: m.from_table,
        from_columns: m.from_columns,
        to_table: m.to_table,
        to_columns: m.to_columns,
        ...(m.note ? { note: m.note } : {}),
      })),
      table_groups: cfg.table_groups,
      collapsed_groups: cfg.collapsed_groups,
      node_positions: cfg.node_positions,
      viewport: cfg.viewport,
      card_density: cfg.card_density ?? 'standard',
    };
    window.localStorage.setItem(`${STORAGE_PREFIX}${sourceKey}`, JSON.stringify(safeCfg));
  } catch {
    // Ignore storage quota / private-mode restrictions.
  }
}
