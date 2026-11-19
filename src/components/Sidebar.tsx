import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { BUILTIN_FIXTURES, BuiltinFixtureId } from '../core/fixtures';
import { GraphQLProvider } from '../core/sources/types';
import { AppState, getGroupSummary, getSearchMatches } from '../state/appState';

interface SidebarProps {
  state: AppState;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (q: string) => void;
  onClearSelection: () => void;
  onSwitchFixture: (fixture: BuiltinFixtureId) => void;
  onLoadGraphQLSnapshot: (provider: GraphQLProvider) => void;
  onToggleGroupCollapsed: (groupName: string) => void;
  onJumpToTable: (tableId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  state,
  searchInputRef,
  onSearchChange,
  onClearSelection,
  onSwitchFixture,
  onLoadGraphQLSnapshot,
  onToggleGroupCollapsed,
  onJumpToTable,
}) => {
  // Track C2: Keep local input value during CJK IME composition so pinyin/stroke editing never stutters
  const [localQuery, setLocalQuery] = useState(state.searchQuery);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) {
      setLocalQuery(state.searchQuery);
    }
  }, [state.searchQuery]);

  const matches = getSearchMatches(state);
  const groups = getGroupSummary(state);
  const searchActive = state.searchQuery.trim().length > 0;
  const tableKindMap = new Map(state.schema.tables.map((t) => [t.id, t.kind]));

  return (
    <aside
      aria-label="Schema 导航栏"
      className="w-[272px] shrink-0 h-full flex flex-col border-r border-[var(--border)] bg-[var(--sidebar)] text-[var(--sidebar-fg)] select-none"
    >
      {/* Panel Title */}
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-[var(--muted-fg)]">
          Schema 导航
        </span>
        <span className="text-[11px] text-[var(--muted-fg)]" title="快捷键：按 / 聚焦搜索，方向键切换关联表，Esc 取消选中">
          / 搜索 · Esc 清除
        </span>
      </div>

      {/* Search Header */}
      <div className="p-2.5 border-b border-[var(--border)] flex flex-col gap-2">
        <div className="relative flex items-center">
          <input
            ref={searchInputRef}
            type="text"
            aria-label="搜索表名、字段名或注释"
            value={localQuery}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              composingRef.current = false;
              const val = e.currentTarget.value;
              setLocalQuery(val);
              onSearchChange(val);
            }}
            onChange={(e) => {
              const val = e.target.value;
              setLocalQuery(val);
              if (!composingRef.current) {
                onSearchChange(val);
              }
            }}
            placeholder="搜索表名、字段或中文注释... (/)"
            className="w-full rounded border border-[var(--border)] bg-[var(--popover)] px-2.5 py-1.5 pr-7 text-xs text-[var(--fg)] placeholder:text-[var(--muted-fg)] focus:outline-none focus:border-[var(--primary)]"
          />
          {localQuery.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setLocalQuery('');
                onSearchChange('');
              }}
              className="absolute right-1.5 p-0.5 text-[var(--muted-fg)] hover:text-[var(--fg)] cursor-pointer"
              aria-label="清空搜索"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--muted-fg)]">
          <span>
            显示 {matches.length} / {state.schema.tables.length} 张表
          </span>
          {state.selectedTableId && (
            <button
              type="button"
              onClick={onClearSelection}
              className="px-1.5 py-0.5 rounded hover:bg-[var(--secondary)] text-[var(--fg)] cursor-pointer"
            >
              取消选中
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto relix-scroll p-2 flex flex-col gap-3">
        {/* Builtin SQL Fixtures */}
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
            内置示例库（SQL）
          </h3>
          <div className="flex flex-wrap gap-1">
            {BUILTIN_FIXTURES.map((fix) => {
              const active = state.sourceKey === `fixture:${fix.id}`;
              return (
                <button
                  key={fix.id}
                  type="button"
                  onClick={() => onSwitchFixture(fix.id)}
                  title={fix.subtitle}
                  className={`px-2 py-1 rounded text-xs font-medium border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[var(--primary)] text-[var(--primary-fg)] border-[var(--primary)]'
                      : 'bg-[var(--popover)] text-[var(--fg)] border-[var(--border)] hover:bg-[var(--secondary)]'
                  }`}
                >
                  {fix.title}
                </button>
              );
            })}
          </div>
        </section>

        {/* Track G: Quick GraphQL Schema Snapshots */}
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
            GRAPHQL 电商 SCHEMA
          </h3>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['saleor', 'Saleor 3.20'],
                ['shopify', 'Shopify 2026-10'],
              ] as Array<[GraphQLProvider, string]>
            ).map(([prov, label]) => {
              const active = state.sourceKey.startsWith(`graphql:${prov}`);
              return (
                <button
                  key={prov}
                  type="button"
                  onClick={() => onLoadGraphQLSnapshot(prov)}
                  className={`px-2 py-1.5 rounded text-xs font-medium border transition-colors cursor-pointer text-left truncate ${
                    active
                      ? 'bg-[var(--primary)] text-[var(--primary-fg)] border-[var(--primary)]'
                      : 'bg-[var(--popover)] text-[var(--fg)] border-[var(--border)] hover:bg-[var(--secondary)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Domain Groups */}
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
              业务域分组 ({groups.length})
            </h3>
            <span className="text-[11px] text-[var(--muted-fg)]">
              {state.autoGroup ? '自动分组' : '按 Schema'}
            </span>
          </div>
          {groups.map(([gname, memberIds]) => {
            const isCollapsed = Boolean(state.config.collapsed_groups[gname]);
            return (
              <div
                key={gname}
                className="flex items-center justify-between px-2 py-1 rounded-[5px] bg-[var(--secondary)]/55"
              >
                <span className="text-xs font-medium truncate">
                  {gname} ({memberIds.length})
                </span>
                {state.autoGroup && (
                  <button
                    type="button"
                    onClick={() => onToggleGroupCollapsed(gname)}
                    aria-label={`${isCollapsed ? '展开' : '折叠'}分组 ${gname}`}
                    className="px-1.5 py-0.5 rounded text-[11px] text-[var(--fg)] hover:bg-[var(--popover)] cursor-pointer shrink-0"
                  >
                    {isCollapsed ? '展开' : '折叠'}
                  </button>
                )}
              </div>
            );
          })}
        </section>

        {/* Tables / Search Results */}
        <section className="flex flex-col gap-1">
          <h3 className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
            {searchActive ? '搜索结果' : '表 / 视图清单'}
          </h3>
          {matches.slice(0, 250).map((m) => {
            const isSelected = state.selectedTableId === m.tableId;
            const kind = tableKindMap.get(m.tableId);
            const isNew = state.newTableIds.has(m.tableId);
            const subtitle =
              m.matchedColumns.length > 0
                ? `${m.group} · ${m.matchedColumns.join(', ')}`
                : m.group;
            return (
              <button
                key={m.tableId}
                type="button"
                onClick={() => onJumpToTable(m.tableId)}
                className={`w-full text-left px-2 py-1.5 rounded-[6px] border transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                  isSelected
                    ? 'bg-[var(--primary)]/15 border-[var(--primary)]'
                    : 'border-transparent hover:bg-[var(--secondary)]/60'
                }`}
              >
                <span className="flex items-center gap-1 min-w-0">
                  <span className="text-xs font-medium truncate">{m.tableName}</span>
                  {kind === 'view' && (
                    <span className="px-1 py-0 rounded text-[10px] font-semibold bg-[var(--accent)] text-[var(--primary)] shrink-0">
                      VIEW
                    </span>
                  )}
                  {kind === 'materialized_view' && (
                    <span className="px-1 py-0 rounded text-[10px] font-semibold bg-[var(--accent)] text-[var(--primary)] shrink-0">
                      MVIEW
                    </span>
                  )}
                  {isNew && (
                    <span className="px-1 py-0 rounded text-[10px] font-semibold bg-[var(--success)]/20 text-[var(--success)] shrink-0">
                      NEW
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-[var(--muted-fg)] truncate max-w-[100px]">
                  {subtitle}
                </span>
              </button>
            );
          })}
          {matches.length > 250 && (
            <div className="px-2 py-1 text-[11px] text-[var(--muted-fg)]">
              还有 {matches.length - 250} 张表，请使用上方搜索框过滤
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
