import React, { useEffect, useState } from 'react';
import { ManualRelation } from '../core/config';
import { ENABLE_INFERENCE } from '../core/featureFlags';
import { tableById } from '../core/model';
import {
  AppState,
  formatColumnBadges,
  getGroupSummary,
  resolveTableGroups,
} from '../state/appState';

type InspectorTab = 'details' | 'sql' | 'warnings';

interface InspectorProps {
  state: AppState;
  onSelectRelation: (relationId: string) => void;
  onJumpToTable: (tableId: string) => void;
  onSetTableGroup: (tableId: string, group: string) => void;
  onCreateManualRelation: (manual: ManualRelation) => void;
  onUpdateManualNote: (relationId: string, note: string) => void;
  onDeleteManualRelation: (relationId: string) => void;
}

const CODE_KEYWORDS = new Set([
  'CREATE',
  'TABLE',
  'VIEW',
  'MATERIALIZED',
  'PARTITION',
  'TYPE',
  'ENUM',
  'DOMAIN',
  'INDEX',
  'UNIQUE',
  'PRIMARY',
  'KEY',
  'FOREIGN',
  'REFERENCES',
  'NOT',
  'NULL',
  'DEFAULT',
  'ALTER',
  'ADD',
  'CONSTRAINT',
  'SELECT',
  'FROM',
  'WHERE',
  'AS',
  'ON',
  'COMMENT',
  'IS',
  'INTEGER',
  'INT',
  'BIGINT',
  'VARCHAR',
  'TEXT',
  'BOOLEAN',
  'TIMESTAMP',
  'NUMERIC',
  'JSON',
  'JSONB',
  'UUID',
  'SCALAR',
  'INPUT',
  'INTERFACE',
  'UNION',
]);

function highlightCodeLine(line: string, format: 'sql' | 'graphql' | 'json'): React.ReactNode {
  const commentMarker = format === 'graphql' ? '#' : '--';
  const commentIdx = format === 'json' ? -1 : line.indexOf(commentMarker);
  const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : '';

  const tokens = codePart.split(/(\b[A-Za-z_][A-Za-z0-9_]*\b|'(?:''|[^'])*'|"(?:\\.|[^"])*")/g);
  return (
    <>
      {tokens.map((tok, idx) => {
        if (!tok) return null;
        if (
          (tok.startsWith("'") && tok.endsWith("'")) ||
          (tok.startsWith('"') && tok.endsWith('"'))
        ) {
          return (
            <span key={idx} className="text-[var(--success)]">
              {tok}
            </span>
          );
        }
        if (CODE_KEYWORDS.has(tok.toUpperCase())) {
          return (
            <span key={idx} className="text-[var(--primary)] font-semibold">
              {tok}
            </span>
          );
        }
        return <React.Fragment key={idx}>{tok}</React.Fragment>;
      })}
      {commentPart && <span className="text-[var(--muted-fg)] italic">{commentPart}</span>}
    </>
  );
}

export const Inspector: React.FC<InspectorProps> = ({
  state,
  onSelectRelation,
  onJumpToTable,
  onSetTableGroup,
  onCreateManualRelation,
  onUpdateManualNote,
  onDeleteManualRelation,
}) => {
  const [tab, setTab] = useState<InspectorTab>('details');
  const [groupInput, setGroupInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

  // Track B1: Accessible Manual Relation creator inside Inspector
  const [manualFromCol, setManualFromCol] = useState('');
  const [manualToTable, setManualToTable] = useState('');
  const [manualToCol, setManualToCol] = useState('');
  const [manualNote, setManualNote] = useState('');

  const selectedTable = state.selectedTableId
    ? tableById(state.schema, state.selectedTableId)
    : undefined;
  const selectedRelation = state.selectedRelationId
    ? state.schema.relations.find((r) => r.id === state.selectedRelationId)
    : undefined;

  const resolvedGroups = resolveTableGroups(state.schema, state.config, state.autoGroup);
  const currentGroup = selectedTable ? resolvedGroups[selectedTable.id] ?? '' : '';

  useEffect(() => {
    setGroupInput(currentGroup);
  }, [selectedTable?.id, currentGroup]);

  useEffect(() => {
    setNoteInput(selectedRelation?.note ?? '');
  }, [selectedRelation?.id, selectedRelation?.note]);

  useEffect(() => {
    if (!selectedTable) return;
    setManualFromCol(selectedTable.columns[0]?.name ?? '');
    const otherTable = state.schema.tables.find((t) => t.id !== selectedTable.id) ?? selectedTable;
    setManualToTable(otherTable?.id ?? '');
    setManualToCol(otherTable?.primary_key[0] ?? otherTable?.columns[0]?.name ?? '');
    setManualNote('');
  }, [selectedTable?.id, state.schema.tables]);

  const targetTableObj = manualToTable ? tableById(state.schema, manualToTable) : undefined;
  useEffect(() => {
    if (!targetTableObj) return;
    if (!targetTableObj.columns.some((c) => c.name === manualToCol)) {
      setManualToCol(targetTableObj.primary_key[0] ?? targetTableObj.columns[0]?.name ?? '');
    }
  }, [targetTableObj, manualToCol]);

  const visibleRels = state.schema.relations.filter(
    (r) => r.status !== 'rejected' && (ENABLE_INFERENCE || r.kind !== 'inferred'),
  );

  const outgoingRels = selectedTable
    ? visibleRels.filter((r) => r.from_table === selectedTable.id)
    : [];
  const incomingRels = selectedTable
    ? visibleRels.filter((r) => r.to_table === selectedTable.id)
    : [];
  const brokenManualRels = visibleRels.filter((r) => r.kind === 'manual' && Boolean(r.missing_target));

  const fkColsForSelected = new Set(outgoingRels.flatMap((r) => r.from_columns));

  const existingGroups = getGroupSummary(state)
    .map(([name]) => name)
    .slice(0, 6);

  const declaredCount = visibleRels.filter((r) => r.kind === 'declared').length;
  const manualCount = visibleRels.filter((r) => r.kind === 'manual').length;

  const showOverview = !selectedTable && !selectedRelation;
  const codeText =
    state.rawSql ?? '-- 当前数据源无附带原始 DDL / SDL 源码';
  const codeLines = codeText.split('\n');

  // Live type-mismatch check for manual relation form (warns without blocking)
  const selectedFromColObj = selectedTable?.columns.find((c) => c.name === manualFromCol);
  const selectedToColObj = targetTableObj?.columns.find((c) => c.name === manualToCol);
  const formTypeMismatch = Boolean(
    selectedFromColObj &&
      selectedToColObj &&
      selectedFromColObj.type_family !== 'other' &&
      selectedToColObj.type_family !== 'other' &&
      selectedFromColObj.type_family !== selectedToColObj.type_family,
  );

  const handleSubmitManualRelation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTable || !manualFromCol || !manualToTable || !manualToCol) return;
    onCreateManualRelation({
      from_table: selectedTable.id,
      from_columns: [manualFromCol],
      to_table: manualToTable,
      to_columns: [manualToCol],
      note: manualNote.trim() || undefined,
    });
    setManualNote('');
  };

  const tableKindLabel = (kind: string, isPartition?: boolean) => {
    if (kind === 'materialized_view') return '物化视图 (MVIEW)';
    if (kind === 'view') return '视图 (VIEW)';
    if (isPartition) return '分区表';
    return '数据表';
  };

  return (
    <aside
      aria-label="详情检查面板"
      className="w-[330px] shrink-0 h-full flex flex-col border-l border-[var(--border)] bg-[var(--sidebar)] text-[var(--sidebar-fg)]"
    >
      {/* Panel Title */}
      <div className="px-3 py-2 border-b border-[var(--border)] text-xs font-semibold tracking-wide text-[var(--muted-fg)]">
        详情面板 (Inspector)
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-2 border-b border-[var(--border)]" role="tablist">
        {(
          [
            ['details', '详情'],
            ['sql', state.rawFormat === 'graphql' ? 'GraphQL SDL' : 'DDL / 源码'],
            ['warnings', `警告 (${state.schema.warnings.length})`],
          ] as Array<[InspectorTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
              tab === id
                ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                : 'border border-[var(--border)] bg-[var(--popover)] text-[var(--fg)] hover:bg-[var(--secondary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab: SQL / SDL */}
      {tab === 'sql' && (
        <div className="flex-1 min-h-0 overflow-auto relix-scroll p-2">
          <div className="rounded border border-[var(--border)] bg-[var(--popover)] font-mono text-[11px] leading-5 overflow-x-auto">
            {codeLines.map((line, i) => (
              <div key={i} className="flex px-2 hover:bg-[var(--secondary)]/40">
                <span className="w-8 shrink-0 pr-2 text-right select-none text-[var(--muted-fg)]">
                  {i + 1}
                </span>
                <span className="whitespace-pre">{highlightCodeLine(line, state.rawFormat)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Warnings */}
      {tab === 'warnings' && (
        <div className="flex-1 min-h-0 overflow-y-auto relix-scroll p-3 flex flex-col gap-2">
          {state.schema.warnings.length === 0 ? (
            <p className="text-xs text-[var(--muted-fg)]">当前数据源无加载或解析警告。</p>
          ) : (
            state.schema.warnings.map((w, idx) => (
              <div
                key={idx}
                className={`p-2 rounded-[6px] text-xs border whitespace-pre-wrap break-words ${
                  w.includes('手动关系失效')
                    ? 'border-[var(--danger)]/50 bg-[var(--danger)]/12 text-[var(--danger)]'
                    : 'border-[var(--warning)]/40 bg-[var(--warning)]/12'
                }`}
              >
                {w}
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Details */}
      {tab === 'details' && (
        <div className="flex-1 min-h-0 overflow-y-auto relix-scroll p-3 flex flex-col gap-3">
          {/* Missing-target manual relation alert banner (Track B1) */}
          {brokenManualRels.length > 0 && (
            <div className="p-2.5 rounded-[8px] border border-[var(--danger)]/50 bg-[var(--danger)]/12 flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold text-[var(--danger)]">
                失效的手动关系 ({brokenManualRels.length})
              </div>
              {brokenManualRels.map((rel) => (
                <div
                  key={rel.id}
                  className="text-xs flex flex-col gap-1 p-1.5 rounded bg-[var(--popover)]/80 border border-[var(--danger)]/30"
                >
                  <div className="font-medium break-words">
                    {rel.from_table}.{rel.from_columns.join(',')} → {rel.to_table}.
                    {rel.to_columns.join(',')}
                  </div>
                  <div className="text-[11px] text-[var(--danger)]">{rel.missing_target}</div>
                  <button
                    type="button"
                    onClick={() => onDeleteManualRelation(rel.id)}
                    className="self-start px-2 py-0.5 rounded text-[11px] bg-[var(--danger)] text-white cursor-pointer"
                  >
                    移除失效关系
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Selected Relation Card */}
          {selectedRelation && (
            <div
              className={`p-2.5 rounded-[8px] bg-[var(--popover)] border flex flex-col gap-2 ${
                selectedRelation.missing_target
                  ? 'border-[var(--danger)]'
                  : selectedRelation.kind === 'manual'
                    ? 'border-[var(--manual)]'
                    : 'border-[var(--primary)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold tracking-wider text-[var(--primary)]">
                  当前选中关系
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                    selectedRelation.kind === 'manual'
                      ? 'bg-[var(--manual)]/15 text-[var(--manual)]'
                      : 'bg-[var(--secondary)] text-[var(--secondary-fg)]'
                  }`}
                >
                  {selectedRelation.kind === 'manual' ? '来源：手动' : '来源：声明外键'}
                </span>
              </div>
              <div className="text-xs font-medium break-words">
                {selectedRelation.from_table} ({selectedRelation.from_columns.join(', ')}) →{' '}
                {selectedRelation.to_table} ({selectedRelation.to_columns.join(', ')})
              </div>
              {selectedRelation.missing_target && (
                <div className="p-1.5 rounded bg-[var(--danger)]/12 text-[11px] text-[var(--danger)]">
                  目标缺失警告：{selectedRelation.missing_target}
                </div>
              )}
              {selectedRelation.type_mismatch && (
                <div className="p-1.5 rounded bg-[var(--warning)]/12 text-[11px] text-[var(--warning)]">
                  注意：两端字段类型族不一致，已保留关系供核对。
                </div>
              )}
              {selectedRelation.evidence.map((ev, idx) => (
                <div key={idx} className="text-xs text-[var(--muted-fg)] break-words">
                  • {ev}
                </div>
              ))}

              {/* Track B1: Editable note & delete for manual relations */}
              {selectedRelation.kind === 'manual' && (
                <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--border)]">
                  <label className="text-[11px] font-medium text-[var(--muted-fg)]">
                    关系备注（支持中文）
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      aria-label="手动关系备注"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onUpdateManualNote(selectedRelation.id, noteInput);
                      }}
                      placeholder="例如：业务层订单关联用户 ID..."
                      className="flex-1 min-w-0 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--manual)]"
                    />
                    <button
                      type="button"
                      onClick={() => onUpdateManualNote(selectedRelation.id, noteInput)}
                      className="px-2 py-1 rounded text-xs font-medium bg-[var(--manual)] text-white hover:opacity-90 cursor-pointer shrink-0"
                    >
                      保存备注
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteManualRelation(selectedRelation.id)}
                    className="self-start mt-1 px-2 py-1 rounded text-xs font-medium bg-[var(--danger)] text-white hover:opacity-90 cursor-pointer"
                  >
                    删除该手动关系
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Selected Table Details */}
          {selectedTable && (
            <div className="flex flex-col gap-3">
              {/* Header */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h2 className="text-base font-semibold break-all">{selectedTable.name}</h2>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--accent)] text-[var(--primary)]">
                    {tableKindLabel(selectedTable.kind, selectedTable.is_partition)}
                  </span>
                </div>
                <div className="text-xs text-[var(--muted-fg)] break-all">
                  {selectedTable.id} · {selectedTable.columns.length} 字段 ·{' '}
                  {selectedTable.indexes.length} 索引
                  {selectedTable.partition_of ? ` · 分区属于 ${selectedTable.partition_of}` : ''}
                </div>
                {selectedTable.comment && (
                  <p className="mt-0.5 p-2 rounded bg-[var(--popover)] border border-[var(--border)] text-xs text-[var(--fg)] whitespace-pre-wrap break-words leading-relaxed">
                    {selectedTable.comment}
                  </p>
                )}
              </div>

              {/* Manual Domain Group Assignment */}
              <div className="p-2 rounded-[6px] bg-[var(--secondary)]/45 flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
                  业务域分组
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    aria-label="表所属业务域分组"
                    value={groupInput}
                    onChange={(e) => setGroupInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSetTableGroup(selectedTable.id, groupInput);
                    }}
                    placeholder="输入分组名称..."
                    className="flex-1 min-w-0 rounded border border-[var(--border)] bg-[var(--popover)] px-2 py-1 text-xs text-[var(--fg)] focus:outline-none focus:border-[var(--primary)]"
                  />
                  <button
                    type="button"
                    onClick={() => onSetTableGroup(selectedTable.id, groupInput)}
                    className="px-2 py-1 rounded text-xs font-medium border border-[var(--border)] bg-[var(--popover)] hover:bg-[var(--secondary)] cursor-pointer"
                  >
                    应用
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {existingGroups.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => onSetTableGroup(selectedTable.id, g)}
                      className="px-1.5 py-0.5 rounded text-[11px] text-[var(--fg)] hover:bg-[var(--popover)] cursor-pointer"
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Track B1: Create Manual Relation form (complements canvas drag) */}
              <form
                onSubmit={handleSubmitManualRelation}
                className="p-2.5 rounded-[6px] border border-[var(--manual)]/35 bg-[var(--manual)]/6 flex flex-col gap-2"
              >
                <div className="text-[11px] font-semibold tracking-wider text-[var(--manual)]">
                  添加手动关系（适合无外键库）
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="flex flex-col gap-0.5 text-[11px] text-[var(--muted-fg)]">
                    当前表字段
                    <select
                      aria-label="手动关系源字段"
                      value={manualFromCol}
                      onChange={(e) => setManualFromCol(e.target.value)}
                      className="rounded border border-[var(--border)] bg-[var(--popover)] px-1.5 py-1 text-xs text-[var(--fg)]"
                    >
                      {selectedTable.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({c.data_type})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5 text-[11px] text-[var(--muted-fg)]">
                    目标表
                    <select
                      aria-label="手动关系目标表"
                      value={manualToTable}
                      onChange={(e) => setManualToTable(e.target.value)}
                      className="rounded border border-[var(--border)] bg-[var(--popover)] px-1.5 py-1 text-xs text-[var(--fg)]"
                    >
                      {state.schema.tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="flex flex-col gap-0.5 text-[11px] text-[var(--muted-fg)]">
                  目标字段
                  <select
                    aria-label="手动关系目标字段"
                    value={manualToCol}
                    onChange={(e) => setManualToCol(e.target.value)}
                    className="rounded border border-[var(--border)] bg-[var(--popover)] px-1.5 py-1 text-xs text-[var(--fg)]"
                  >
                    {(targetTableObj?.columns ?? []).map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.data_type})
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  type="text"
                  aria-label="新建手动关系备注"
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                  placeholder="备注（可选，例如：业务外键）"
                  className="rounded border border-[var(--border)] bg-[var(--popover)] px-2 py-1 text-xs text-[var(--fg)]"
                />
                {formTypeMismatch && (
                  <div className="text-[11px] text-[var(--warning)]">
                    提示：两端字段类型族不同（{selectedFromColObj?.type_family} vs{' '}
                    {selectedToColObj?.type_family}），仍允许创建。
                  </div>
                )}
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded text-xs font-medium bg-[var(--manual)] text-white hover:opacity-90 cursor-pointer"
                >
                  创建手动关系
                </button>
              </form>

              {/* Columns */}
              <div className="flex flex-col gap-1">
                <div className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
                  字段清单 ({selectedTable.columns.length})
                </div>
                {selectedTable.columns.map((col) => {
                  const badges = formatColumnBadges(selectedTable, col.name, fkColsForSelected);
                  const nullTag = col.nullable ? '可空' : '非空';
                  const meta = col.default
                    ? `${col.data_type} · ${nullTag} · 默认=${col.default}`
                    : `${col.data_type} · ${nullTag}`;
                  const isMod = Boolean(state.changedColumns[selectedTable.id]?.has(col.name));
                  return (
                    <div
                      key={col.name}
                      className="p-2 rounded-[5px] bg-[var(--popover)]/85 border border-[var(--border)] flex flex-col gap-0.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold break-all">{col.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {isMod && (
                            <span className="px-1 rounded text-[10px] font-semibold bg-[var(--success)]/15 text-[var(--success)]">
                              MOD
                            </span>
                          )}
                          {badges.map((b) => (
                            <span
                              key={b}
                              className={`px-1 rounded text-[10px] font-semibold ${
                                b === 'PK'
                                  ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                                  : b === 'FK'
                                    ? 'bg-[var(--manual)]/15 text-[var(--manual)]'
                                    : 'bg-[var(--warning)]/15 text-[var(--warning)]'
                              }`}
                            >
                              {b}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-[11px] text-[var(--muted-fg)] break-words">{meta}</div>
                      {col.comment && (
                        <div className="mt-0.5 text-[11px] text-[var(--fg)]/85 whitespace-pre-wrap break-words leading-relaxed">
                          {col.comment}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Indexes */}
              {selectedTable.indexes.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
                    索引 ({selectedTable.indexes.length})
                  </div>
                  {selectedTable.indexes.map((ix) => (
                    <div
                      key={ix.name}
                      className="text-xs p-1.5 rounded bg-[var(--secondary)]/40 break-words"
                    >
                      {ix.unique ? 'UNIQUE' : 'INDEX'} {ix.name} ({ix.columns.join(', ')})
                    </div>
                  ))}
                </div>
              )}

              {/* Outgoing References */}
              <div className="flex flex-col gap-1">
                <div className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
                  引用目标 ({outgoingRels.length})
                </div>
                {outgoingRels.map((rel) => {
                  const isManual = rel.kind === 'manual';
                  return (
                    <div
                      key={rel.id}
                      className="flex items-center justify-between gap-1.5 p-1.5 rounded-[5px] bg-[var(--secondary)]/40"
                    >
                      <span className="text-xs truncate">
                        ({rel.from_columns.join(', ')}) → {rel.to_table}{' '}
                        <span className={isManual ? 'text-[var(--manual)] font-medium' : ''}>
                          [{isManual ? '手动' : '外键'}]
                        </span>
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onSelectRelation(rel.id)}
                          className="px-1.5 py-0.5 rounded text-[11px] hover:bg-[var(--popover)] cursor-pointer"
                        >
                          查看
                        </button>
                        <button
                          type="button"
                          onClick={() => onJumpToTable(rel.to_table)}
                          className="px-1.5 py-0.5 rounded text-[11px] hover:bg-[var(--popover)] cursor-pointer"
                        >
                          跳转
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Incoming Referenced By */}
              <div className="flex flex-col gap-1">
                <div className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
                  被以下表引用 ({incomingRels.length})
                </div>
                {incomingRels.map((rel) => (
                  <div
                    key={rel.id}
                    className="flex items-center justify-between gap-1.5 p-1.5 rounded-[5px] bg-[var(--secondary)]/40"
                  >
                    <span className="text-xs truncate">
                      {rel.from_table} ({rel.from_columns.join(', ')})
                    </span>
                    <button
                      type="button"
                      onClick={() => onJumpToTable(rel.from_table)}
                      className="px-1.5 py-0.5 rounded text-[11px] hover:bg-[var(--popover)] cursor-pointer shrink-0"
                    >
                      跳转
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schema Overview (Zero Inference stats per Track F1) */}
          {showOverview && (
            <div className="p-3 rounded-[8px] bg-[var(--popover)] border border-[var(--border)] flex flex-col gap-1.5">
              <div className="text-sm font-semibold">Schema 概览</div>
              <div className="text-xs">方言 / 来源：{state.schema.dialect}</div>
              {state.snapshotVersion && (
                <div className="text-xs">
                  快照版本：{state.snapshotVersion}
                  {state.snapshotTime ? `（${state.snapshotTime}）` : ''}
                </div>
              )}
              <div className="text-xs">表 / 视图总数：{state.schema.tables.length}</div>
              <div className="text-xs">声明外键关系：{declaredCount}</div>
              <div className="text-xs">用户手动关系：{manualCount}</div>
              <p className="pt-2 text-xs text-[var(--muted-fg)] leading-relaxed">
                点击任意表卡片可高亮 1 跳上下游关联并查看完整字段与中文注释；若当前库缺少声明外键，可开启顶部「手动连线」或在选中表后直接添加手动关系。
              </p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
