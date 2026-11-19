import React, { useMemo, useState } from 'react';
import { CardDensity, ProjectConfig } from '../core/config';
import {
  EXPORT_FORMATS,
  ExportFormat,
  ExportTheme,
  renderExport,
} from '../core/export';
import { Schema } from '../core/model';

interface ExportModalProps {
  schema: Schema;
  config: ProjectConfig;
  defaultDark: boolean;
  density: CardDensity;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  schema,
  config,
  defaultDark,
  density,
  onClose,
}) => {
  const [format, setFormat] = useState<ExportFormat>('mermaid');
  const [theme, setTheme] = useState<ExportTheme>(defaultDark ? 'dark' : 'light');
  const [status, setStatus] = useState<string | null>(null);

  const formatMeta = EXPORT_FORMATS.find((f) => f.id === format) ?? EXPORT_FORMATS[0];
  const fullContent = useMemo(
    () => renderExport(schema, config, format, { theme, density }),
    [schema, config, format, theme, density],
  );

  const previewContent = useMemo(() => {
    if (fullContent.length > 48000) {
      return `${fullContent.slice(0, 48000)}\n\n<!-- 预览已截断至 48KB（复制与下载仍输出完整内容） -->`;
    }
    return fullContent;
  }, [fullContent]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullContent);
      setStatus(`已将 ${formatMeta.label} 复制到剪贴板。`);
    } catch {
      setStatus('剪贴板写入受限，请直接从预览框复制。');
    }
  };

  const handleDownload = () => {
    const mimeMap: Record<ExportFormat, string> = {
      mermaid: 'text/plain;charset=utf-8',
      markdown: 'text/markdown;charset=utf-8',
      svg: 'image/svg+xml;charset=utf-8',
      html: 'text/html;charset=utf-8',
      json: 'application/json;charset=utf-8',
    };
    const filename = `relix-export.${formatMeta.extension}`;
    const blob = new Blob([fullContent], { type: mimeMap[format] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`已下载 ${filename}`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="导出 Schema 与 ER 图"
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[700px] max-w-full max-h-[90vh] p-4 rounded-[10px] bg-[var(--popover)] border border-[var(--border)] shadow-xl flex flex-col gap-3 text-[var(--fg)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">导出文档与 ER 图</h2>
            <p className="text-xs text-[var(--muted-fg)]">
              仅包含声明外键与手动关系（均标注来源），不含任何业务数据或连接凭据
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded text-xs hover:bg-[var(--secondary)] cursor-pointer"
          >
            关闭
          </button>
        </div>

        {/* Format & Theme Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist">
            {EXPORT_FORMATS.map((fmt) => (
              <button
                key={fmt.id}
                type="button"
                role="tab"
                aria-selected={format === fmt.id}
                onClick={() => {
                  setFormat(fmt.id);
                  setStatus(null);
                }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                  format === fmt.id
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                    : 'border border-[var(--border)] bg-[var(--sidebar)] text-[var(--fg)] hover:bg-[var(--secondary)]'
                }`}
              >
                {fmt.label}
              </button>
            ))}
          </div>

          {(format === 'svg' || format === 'html') && (
            <div className="inline-flex items-center gap-1 text-xs">
              <span className="text-[var(--muted-fg)]">导出外观：</span>
              <button
                type="button"
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
                className={`px-2 py-0.5 rounded border text-xs cursor-pointer ${
                  theme === 'light'
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)] border-[var(--primary)]'
                    : 'border-[var(--border)] bg-[var(--sidebar)]'
                }`}
              >
                浅色
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
                className={`px-2 py-0.5 rounded border text-xs cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)] border-[var(--primary)]'
                    : 'border-[var(--border)] bg-[var(--sidebar)]'
                }`}
              >
                深色
              </button>
            </div>
          )}
        </div>

        {/* Read-only Preview */}
        <textarea
          readOnly
          aria-label="导出内容预览"
          value={previewContent}
          spellCheck={false}
          className="w-full h-[320px] p-2.5 rounded border border-[var(--border)] bg-[var(--bg)] font-mono text-xs text-[var(--fg)] resize-none focus:outline-none relix-scroll"
        />

        {/* Actions */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--muted-fg)]">
            文件名：relix-export.{formatMeta.extension}（{fullContent.length.toLocaleString()} 字节）
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-1.5 rounded text-xs font-medium border border-[var(--border)] bg-[var(--sidebar)] hover:bg-[var(--secondary)] cursor-pointer"
            >
              下载文件
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-1.5 rounded text-xs font-medium bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-90 cursor-pointer"
            >
              复制到剪贴板
            </button>
          </div>
        </div>

        {status && (
          <div className="p-2 rounded-[6px] bg-[var(--secondary)] text-xs text-[var(--fg)]">
            {status}
          </div>
        )}
      </div>
    </div>
  );
};
