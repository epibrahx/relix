import React from 'react';
import {
  Download,
  FolderOpen,
  Link2,
  Moon,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Sun,
} from 'lucide-react';
import { CardDensity } from '../core/config';
import { redactConnectionUrl } from '../core/redact';

interface ToolbarProps {
  sourceLabel: string;
  snapshotVersion?: string;
  snapshotTime?: string;
  leftOpen: boolean;
  rightOpen: boolean;
  focusMode: boolean;
  focusHops: number;
  autoGroup: boolean;
  cardDensity: CardDensity;
  linkMode: boolean;
  hasSelectedTable: boolean;
  zoomPct: number;
  isDark: boolean;
  isReloading: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpenImport: () => void;
  onOpenExport: () => void;
  onReloadSource: () => void;
  onToggleLinkMode: () => void;
  onChangeDensity: (density: CardDensity) => void;
  onToggleFocusMode: () => void;
  onAdjustFocusHops: (delta: number) => void;
  onToggleAutoGroup: () => void;
  onFitView: () => void;
  onAutoLayout: () => void;
  onToggleTheme: () => void;
}

const btnBase =
  'inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer select-none whitespace-nowrap';
const btnGhost = `${btnBase} text-[var(--fg)] hover:bg-[var(--secondary)]`;
const btnDefault = `${btnBase} border border-[var(--border)] bg-[var(--popover)] text-[var(--fg)] hover:bg-[var(--secondary)]`;
const btnPrimary = `${btnBase} bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-90`;
const btnManualActive = `${btnBase} bg-[var(--manual)] text-white hover:opacity-90`;

const DENSITY_OPTIONS: Array<{ id: CardDensity; label: string }> = [
  { id: 'compact', label: '紧凑' },
  { id: 'standard', label: '标准' },
  { id: 'detailed', label: '详细' },
];

export const Toolbar: React.FC<ToolbarProps> = ({
  sourceLabel,
  snapshotVersion,
  snapshotTime,
  leftOpen,
  rightOpen,
  focusMode,
  focusHops,
  autoGroup,
  cardDensity,
  linkMode,
  hasSelectedTable,
  zoomPct,
  isDark,
  isReloading,
  onToggleLeft,
  onToggleRight,
  onOpenImport,
  onOpenExport,
  onReloadSource,
  onToggleLinkMode,
  onChangeDensity,
  onToggleFocusMode,
  onAdjustFocusHops,
  onToggleAutoGroup,
  onFitView,
  onAutoLayout,
  onToggleTheme,
}) => {
  const focusLabel = focusMode
    ? `聚焦 ${focusHops} 跳`
    : hasSelectedTable
      ? `聚焦 (${focusHops}跳)`
      : '聚焦';

  return (
    <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--title-bar)] text-[var(--fg)] shrink-0 overflow-x-auto">
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          className={btnGhost}
          onClick={onToggleLeft}
          aria-label={leftOpen ? '隐藏左侧导航' : '显示左侧导航'}
          title={leftOpen ? '隐藏左侧导航' : '显示左侧导航'}
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-sm font-semibold tracking-tight pr-1">RELIX</span>
        <span
          className="px-2 py-0.5 rounded bg-[var(--secondary)] text-[var(--secondary-fg)] text-xs max-w-[230px] truncate"
          title={redactConnectionUrl(sourceLabel)}
        >
          {redactConnectionUrl(sourceLabel)}
        </span>
        {snapshotVersion && (
          <span
            className="hidden xl:inline-flex items-center px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--popover)] text-[11px] text-[var(--muted-fg)]"
            title={snapshotTime ? `快照时间：${snapshotTime}` : snapshotVersion}
          >
            {snapshotTime ? `${snapshotVersion} · ${snapshotTime}` : snapshotVersion}
          </span>
        )}
        <button type="button" className={btnPrimary} onClick={onOpenImport}>
          <FolderOpen className="w-3.5 h-3.5" />
          打开 / 导入
        </button>
        <button
          type="button"
          className={btnDefault}
          onClick={onReloadSource}
          disabled={isReloading}
          title="重新读取当前数据源（保留现有节点坐标，标记新增表与变更字段）"
          aria-label="重新读取"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isReloading ? 'animate-spin' : ''}`} />
          重新读取
        </button>
        <button type="button" className={btnDefault} onClick={onOpenExport}>
          <Download className="w-3.5 h-3.5" />
          导出
        </button>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {/* Track B1: Manual Link Mode toggle */}
        <button
          type="button"
          className={linkMode ? btnManualActive : btnDefault}
          onClick={onToggleLinkMode}
          aria-pressed={linkMode}
          title="开启后可在画布上从任意字段拖线到目标表字段，创建手动关系"
        >
          <Link2 className="w-3.5 h-3.5" />
          {linkMode ? '连线模式中' : '手动连线'}
        </button>

        {/* Track D5: 3-level Card Density switcher */}
        <div
          className="inline-flex items-center rounded border border-[var(--border)] bg-[var(--popover)] p-0.5"
          role="group"
          aria-label="表卡片显示密度"
        >
          {DENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeDensity(opt.id)}
              aria-pressed={cardDensity === opt.id}
              className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                cardDensity === opt.id
                  ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                  : 'text-[var(--muted-fg)] hover:text-[var(--fg)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={focusMode ? btnPrimary : btnDefault}
          onClick={onToggleFocusMode}
          aria-pressed={focusMode}
          title="仅展示当前选中表 N 跳范围内的上下游关联表"
        >
          {focusLabel}
        </button>
        <button
          type="button"
          className={btnGhost}
          onClick={() => onAdjustFocusHops(-1)}
          title="减少聚焦跳数"
          aria-label="减少聚焦跳数"
        >
          -
        </button>
        <button
          type="button"
          className={btnGhost}
          onClick={() => onAdjustFocusHops(1)}
          title="增加聚焦跳数"
          aria-label="增加聚焦跳数"
        >
          +
        </button>

        <button
          type="button"
          className={autoGroup ? btnPrimary : btnDefault}
          onClick={onToggleAutoGroup}
          aria-pressed={autoGroup}
        >
          分组
        </button>
        <button type="button" className={btnDefault} onClick={onFitView} title="缩放以适配全部表">
          适配 ({zoomPct}%)
        </button>
        <button type="button" className={btnDefault} onClick={onAutoLayout} title="重新计算分层自动布局">
          自动布局
        </button>
        <button
          type="button"
          className={btnGhost}
          onClick={onToggleTheme}
          title={isDark ? '切换为浅色主题' : '切换为深色主题'}
          aria-label={isDark ? '切换为浅色主题' : '切换为深色主题'}
        >
          {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          className={btnGhost}
          onClick={onToggleRight}
          aria-label={rightOpen ? '隐藏右侧详情面板' : '显示右侧详情面板'}
          title={rightOpen ? '隐藏右侧详情面板' : '显示右侧详情面板'}
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
