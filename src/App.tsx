import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ErCanvas, ErCanvasHandle } from './components/ErCanvas';
import { ExportModal } from './components/ExportModal';
import { ImportModal } from './components/ImportModal';
import { Inspector } from './components/Inspector';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { CardDensity, ManualRelation } from './core/config';
import {
  BuiltinFixtureId,
  SourceSpec,
  loadSource,
  loadSourceAsync,
} from './core/fixtures';
import { redactConnectionUrl } from './core/redact';
import { GraphQLProvider } from './core/sources/types';
import {
  AppState,
  createAppStateFromLoaded,
  resolveTableGroups,
  stateAddManualRelation,
  stateDeleteManualRelation,
  stateDropNode,
  stateReloadFromLoaded,
  stateResetAutoLayout,
  stateSetCardDensity,
  stateSetTableGroup,
  stateToggleGroupCollapsed,
  stateToggleTableExpanded,
  stateUpdateManualRelationNote,
  withRebuiltScene,
} from './state/appState';

function getInitialSource(): SourceSpec {
  const params = new URLSearchParams(window.location.search);
  const benchParam = params.get('bench');
  if (benchParam) {
    const n = Number.parseInt(benchParam, 10);
    if (Number.isFinite(n) && n > 0 && n <= 2000) {
      return { type: 'bench', tables: n };
    }
  }
  const sourceParam = params.get('source');
  if (sourceParam === 'saleor' || sourceParam === 'shopify') {
    return { type: 'graphql_snapshot', provider: sourceParam };
  }
  // Track E1: Default built-in demo is 01_ecommerce
  return { type: 'builtin', fixture: 'ecommerce' };
}

export const App: React.FC = () => {
  const [state, setState] = useState<AppState>(() => {
    const loaded = loadSource(getInitialSource());
    return createAppStateFromLoaded(loaded);
  });

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [zoomPct, setZoomPct] = useState(() =>
    Math.round(
      (state.config.viewport.zoom !== 1
        ? state.config.viewport.zoom
        : state.schema.tables.length > 100
          ? 0.65
          : 1) * 100,
    ),
  );

  // Sync initial appearance with OS preference and allow manual override
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [isDark]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (ev: MediaQueryListEvent) => setIsDark(ev.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const canvasRef = useRef<ErCanvasHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const vp = state.config.viewport;
    if (vp.zoom === 1 && vp.pan_x === 0 && vp.pan_y === 0 && state.schema.tables.length <= 120) {
      requestAnimationFrame(() => {
        canvasRef.current?.fitToView();
      });
    }
    // Only auto-fit once on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadSource = useCallback(async (spec: SourceSpec): Promise<string | null> => {
    try {
      const loaded = await loadSourceAsync(spec);
      const next = createAppStateFromLoaded(loaded);
      setState(next);
      requestAnimationFrame(() => {
        canvasRef.current?.resetCameraForNewSource(next);
      });
      return null;
    } catch (err) {
      return redactConnectionUrl(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleReloadSource = useCallback(async () => {
    setIsReloading(true);
    try {
      const spec = state.sourceSpec;
      const loaded = await loadSourceAsync(spec);
      setState((prev) => stateReloadFromLoaded(prev, loaded));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        lastError: redactConnectionUrl(err instanceof Error ? err.message : String(err)),
      }));
    } finally {
      setIsReloading(false);
    }
  }, [state.sourceSpec]);

  const handleSwitchFixture = useCallback(
    (fixture: BuiltinFixtureId) => {
      void handleLoadSource({ type: 'builtin', fixture }).then((err) => {
        if (err) setState((prev) => ({ ...prev, lastError: err }));
      });
    },
    [handleLoadSource],
  );

  const handleLoadGraphQLSnapshot = useCallback(
    (provider: GraphQLProvider) => {
      void handleLoadSource({ type: 'graphql_snapshot', provider }).then((err) => {
        if (err) setState((prev) => ({ ...prev, lastError: err }));
      });
    },
    [handleLoadSource],
  );

  const handleJumpToTable = useCallback((tableId: string) => {
    setState((prev) => {
      const config = { ...prev.config, collapsed_groups: { ...prev.config.collapsed_groups } };
      const groups = resolveTableGroups(prev.schema, config, prev.autoGroup);
      const g = groups[tableId];
      if (g && config.collapsed_groups[g]) {
        config.collapsed_groups[g] = false;
      }
      const next = withRebuiltScene({
        ...prev,
        config,
        selectedTableId: tableId,
        selectedRelationId: null,
        flashTable: { tableId, startedAt: performance.now() },
      });
      requestAnimationFrame(() => {
        canvasRef.current?.jumpToTable(tableId, next);
      });
      return next;
    });
  }, []);

  const handleSelectTable = useCallback((tableId: string | null) => {
    setState((prev) =>
      withRebuiltScene({
        ...prev,
        selectedTableId: tableId,
        selectedRelationId: null,
      }),
    );
  }, []);

  const handleSelectRelation = useCallback((relationId: string | null) => {
    setState((prev) =>
      withRebuiltScene({
        ...prev,
        selectedRelationId: relationId,
      }),
    );
  }, []);

  const handleToggleFocusMode = useCallback(() => {
    setState((prev) => withRebuiltScene({ ...prev, focusMode: !prev.focusMode }));
  }, []);

  const handleAdjustFocusHops = useCallback((delta: number) => {
    setState((prev) => {
      const nextHops = Math.max(1, Math.min(5, prev.focusHops + delta));
      const updated = { ...prev, focusHops: nextHops };
      return prev.focusMode ? withRebuiltScene(updated) : updated;
    });
  }, []);

  const handleToggleAutoGroup = useCallback(() => {
    setState((prev) => withRebuiltScene({ ...prev, autoGroup: !prev.autoGroup }));
  }, []);

  const handleChangeDensity = useCallback((density: CardDensity) => {
    setState((prev) => stateSetCardDensity(prev, density));
  }, []);

  const handleToggleLinkMode = useCallback(() => {
    setState((prev) => ({ ...prev, linkMode: !prev.linkMode }));
  }, []);

  const handleAutoLayout = useCallback(() => {
    setState((prev) => stateResetAutoLayout(prev));
    requestAnimationFrame(() => {
      canvasRef.current?.fitToView();
    });
  }, []);

  const handleToggleTableExpanded = useCallback((tableId: string) => {
    setState((prev) => stateToggleTableExpanded(prev, tableId));
  }, []);

  const handleToggleGroupCollapsed = useCallback((groupName: string) => {
    setState((prev) => stateToggleGroupCollapsed(prev, groupName));
  }, []);

  const handleSetTableGroup = useCallback((tableId: string, group: string) => {
    setState((prev) => stateSetTableGroup(prev, tableId, group));
  }, []);

  const handleDropNode = useCallback(
    (
      nodeId: string,
      isTable: boolean,
      x: number,
      y: number,
      zoom: number,
      panX: number,
      panY: number,
    ) => {
      setState((prev) => stateDropNode(prev, nodeId, isTable, x, y, zoom, panX, panY));
    },
    [],
  );

  const handleCreateManualRelation = useCallback((manual: ManualRelation) => {
    setState((prev) => stateAddManualRelation(prev, manual).nextState);
  }, []);

  const handleUpdateManualNote = useCallback((relationId: string, note: string) => {
    setState((prev) => stateUpdateManualRelationNote(prev, relationId, note));
  }, []);

  const handleDeleteManualRelation = useCallback((relationId: string) => {
    setState((prev) => stateDeleteManualRelation(prev, relationId));
  }, []);

  const handleClearFlash = useCallback(() => {
    setState((prev) => (prev.flashTable ? { ...prev, flashTable: null } : prev));
  }, []);

  // Track D6: Keyboard navigation (`/` focuses search, `Esc` cancels/deselects, Arrows traverse connected tables)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (showImport) {
          setShowImport(false);
          return;
        }
        if (showExport) {
          setShowExport(false);
          return;
        }
        setState((prev) => {
          if (prev.linkMode) return { ...prev, linkMode: false };
          if (prev.selectedRelationId || prev.selectedTableId) {
            return withRebuiltScene({
              ...prev,
              selectedTableId: null,
              selectedRelationId: null,
            });
          }
          return prev;
        });
        return;
      }

      if (inInput) return;

      if (e.key === '/') {
        e.preventDefault();
        setLeftOpen(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }

      if (
        (e.key === 'ArrowRight' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowUp') &&
        state.selectedTableId
      ) {
        const curId = state.selectedTableId;
        const connected: string[] = [];
        const seen = new Set<string>([curId]);
        for (const edge of state.scene.edges) {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            if (edge.fromTable === curId && !seen.has(edge.toTable)) {
              seen.add(edge.toTable);
              connected.push(edge.toTable);
            } else if (edge.toTable === curId && !seen.has(edge.fromTable)) {
              seen.add(edge.fromTable);
              connected.push(edge.fromTable);
            }
          } else {
            if (edge.toTable === curId && !seen.has(edge.fromTable)) {
              seen.add(edge.fromTable);
              connected.push(edge.fromTable);
            } else if (edge.fromTable === curId && !seen.has(edge.toTable)) {
              seen.add(edge.toTable);
              connected.push(edge.toTable);
            }
          }
        }
        if (connected.length > 0) {
          e.preventDefault();
          handleJumpToTable(connected[0]);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showImport, showExport, state.selectedTableId, state.scene.edges, handleJumpToTable]);

  return (
    <div className="relative flex flex-col w-full h-full bg-[var(--bg)] text-[var(--fg)] overflow-hidden">
      <Toolbar
        sourceLabel={state.sourceLabel}
        snapshotVersion={state.snapshotVersion}
        snapshotTime={state.snapshotTime}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        focusMode={state.focusMode}
        focusHops={state.focusHops}
        autoGroup={state.autoGroup}
        cardDensity={state.cardDensity}
        linkMode={state.linkMode}
        hasSelectedTable={state.selectedTableId !== null}
        zoomPct={zoomPct}
        isDark={isDark}
        isReloading={isReloading}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onOpenImport={() => {
          setShowExport(false);
          setShowImport((v) => !v);
        }}
        onOpenExport={() => {
          setShowImport(false);
          setShowExport((v) => !v);
        }}
        onReloadSource={() => void handleReloadSource()}
        onToggleLinkMode={handleToggleLinkMode}
        onChangeDensity={handleChangeDensity}
        onToggleFocusMode={handleToggleFocusMode}
        onAdjustFocusHops={handleAdjustFocusHops}
        onToggleAutoGroup={handleToggleAutoGroup}
        onFitView={() => canvasRef.current?.fitToView()}
        onAutoLayout={handleAutoLayout}
        onToggleTheme={() => setIsDark((v) => !v)}
      />

      {state.lastError && (
        <div
          role="alert"
          className="px-3 py-1.5 bg-[var(--danger)]/15 border-b border-[var(--danger)]/40 text-xs text-[var(--danger)] flex items-center justify-between gap-2"
        >
          <span>{redactConnectionUrl(state.lastError)}</span>
          <button
            type="button"
            onClick={() => setState((prev) => ({ ...prev, lastError: null }))}
            className="text-xs underline cursor-pointer shrink-0"
          >
            关闭
          </button>
        </div>
      )}

      {state.statusBanner && !state.lastError && (
        <div className="px-3 py-1 bg-[var(--accent)]/60 border-b border-[var(--border)] text-xs text-[var(--fg)] flex items-center justify-between gap-2">
          <span>{state.statusBanner}</span>
          <button
            type="button"
            onClick={() => setState((prev) => ({ ...prev, statusBanner: null }))}
            className="text-xs underline cursor-pointer shrink-0"
          >
            知道了
          </button>
        </div>
      )}

      {/* Dock Workbench: Left Navigator + Center ER Canvas + Right Inspector */}
      <main className="flex-1 min-h-0 flex w-full overflow-hidden">
        {leftOpen && (
          <Sidebar
            state={state}
            searchInputRef={searchInputRef}
            onSearchChange={(q) => setState((prev) => ({ ...prev, searchQuery: q }))}
            onClearSelection={() => handleSelectTable(null)}
            onSwitchFixture={handleSwitchFixture}
            onLoadGraphQLSnapshot={handleLoadGraphQLSnapshot}
            onToggleGroupCollapsed={handleToggleGroupCollapsed}
            onJumpToTable={handleJumpToTable}
          />
        )}

        <ErCanvas
          ref={canvasRef}
          state={state}
          isDark={isDark}
          onZoomChange={setZoomPct}
          onSelectTable={handleSelectTable}
          onSelectRelation={handleSelectRelation}
          onToggleTableExpanded={handleToggleTableExpanded}
          onToggleGroupCollapsed={handleToggleGroupCollapsed}
          onDropNode={handleDropNode}
          onCreateManualRelation={handleCreateManualRelation}
          onDeleteManualRelation={handleDeleteManualRelation}
          onClearFlash={handleClearFlash}
        />

        {rightOpen && (
          <Inspector
            state={state}
            onSelectRelation={(rid) => handleSelectRelation(rid)}
            onJumpToTable={handleJumpToTable}
            onSetTableGroup={handleSetTableGroup}
            onCreateManualRelation={handleCreateManualRelation}
            onUpdateManualNote={handleUpdateManualNote}
            onDeleteManualRelation={handleDeleteManualRelation}
          />
        )}
      </main>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onLoadSource={handleLoadSource}
        />
      )}

      {showExport && (
        <ExportModal
          schema={state.schema}
          config={state.config}
          defaultDark={isDark}
          density={state.cardDensity}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
};

export default App;
