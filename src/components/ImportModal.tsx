import React, { useRef, useState } from 'react';
import { Globe, ShieldCheck, Upload } from 'lucide-react';
import { SourceSpec } from '../core/fixtures';
import { redactConnectionUrl } from '../core/redact';
import {
  SALEOR_SNAPSHOT_DATE,
  SALEOR_SNAPSHOT_VERSION,
} from '../core/sources/saleor';
import {
  SHOPIFY_PUBLIC_PROXY_BASE,
  SHOPIFY_SNAPSHOT_DATE,
  SHOPIFY_SNAPSHOT_VERSION,
} from '../core/sources/shopify';
import { GraphQLProvider } from '../core/sources/types';

type ImportTab = 'graphql' | 'sql_json';

interface ImportModalProps {
  onClose: () => void;
  onLoadSource: (spec: SourceSpec) => Promise<string | null> | string | null;
}

const DEFAULT_PASTE_SQL = `-- 在此粘贴 SQL DDL 或已导出的 Schema JSON（100% 本地解析，不上传服务端）
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts (id)
);`;

export const ImportModal: React.FC<ImportModalProps> = ({ onClose, onLoadSource }) => {
  const [tab, setTab] = useState<ImportTab>('graphql');
  const [content, setContent] = useState(DEFAULT_PASTE_SQL);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Track G4: Live GraphQL Introspection form states (tokens live in component state only, never persisted)
  const [saleorEndpoint, setSaleorEndpoint] = useState('https://demo.saleor.io/graphql/');
  const [saleorToken, setSaleorToken] = useState('');

  const [shopifyMode, setShopifyMode] = useState<'public_proxy' | 'store'>('public_proxy');
  const [shopifyVersion, setShopifyVersion] = useState('2026-10');
  const [shopifyStoreDomain, setShopifyStoreDomain] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');

  const sqlFileInputRef = useRef<HTMLInputElement>(null);
  const gqlFileInputRef = useRef<HTMLInputElement>(null);
  const gqlUploadProviderRef = useRef<GraphQLProvider>('saleor');

  const runLoad = async (spec: SourceSpec) => {
    setBusy(true);
    setError(null);
    try {
      const err = await onLoadSource(spec);
      if (err) {
        setError(redactConnectionUrl(err));
      } else {
        // Clear in-memory tokens immediately on successful load
        setSaleorToken('');
        setShopifyToken('');
        onClose();
      }
    } catch (err) {
      setError(redactConnectionUrl(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const handleParsePasted = () => {
    const trimmed = content.trim();
    if (!trimmed) {
      setError('请先粘贴 SQL DDL 或 Schema JSON 内容。');
      return;
    }
    const spec: SourceSpec = trimmed.startsWith('{')
      ? { type: 'json', label: '粘贴内容：schema.json', json: trimmed }
      : { type: 'sql', label: '粘贴内容：schema.sql', sql: trimmed };
    void runLoad(spec);
  };

  const handleSqlFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const trimmed = text.trim();
      const isJson = file.name.toLowerCase().endsWith('.json') || trimmed.startsWith('{');
      const spec: SourceSpec = isJson
        ? { type: 'json', label: file.name, json: text }
        : { type: 'sql', label: file.name, sql: text };
      await runLoad(spec);
    } catch (err) {
      setError(redactConnectionUrl(err instanceof Error ? err.message : String(err)));
    } finally {
      e.target.value = '';
    }
  };

  const handleGqlFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await runLoad({
        type: 'graphql_sdl',
        provider: gqlUploadProviderRef.current,
        label: file.name,
        content: text,
      });
    } catch (err) {
      setError(redactConnectionUrl(err instanceof Error ? err.message : String(err)));
    } finally {
      e.target.value = '';
    }
  };

  const handleFetchSaleorLive = () => {
    const url = saleorEndpoint.trim();
    if (!url) {
      setError('请输入 Saleor GraphQL 端点地址。');
      return;
    }
    void runLoad({
      type: 'graphql_live',
      provider: 'saleor',
      endpoint: url,
      token: saleorToken.trim() || undefined,
    });
  };

  const handleFetchShopifyLive = () => {
    const ver = shopifyVersion.trim() || '2026-10';
    if (shopifyMode === 'public_proxy') {
      void runLoad({
        type: 'graphql_live',
        provider: 'shopify',
        endpoint: `${SHOPIFY_PUBLIC_PROXY_BASE}/${ver}`,
        apiVersion: ver,
      });
      return;
    }
    const domain = shopifyStoreDomain
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '');
    if (!domain) {
      setError('请输入 Shopify 店铺域名（如 my-store.myshopify.com）。');
      return;
    }
    if (!shopifyToken.trim()) {
      setError('连接真实店铺端点需要填写只读 Admin API Access Token（仅驻留内存，不落地）。');
      return;
    }
    void runLoad({
      type: 'graphql_live',
      provider: 'shopify',
      endpoint: `https://${domain}/admin/api/${ver}/graphql.json`,
      token: shopifyToken.trim(),
      apiVersion: ver,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="打开或导入数据源"
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[740px] max-w-full max-h-[90vh] p-4 rounded-[10px] bg-[var(--popover)] border border-[var(--border)] shadow-xl flex flex-col gap-3 text-[var(--fg)] overflow-hidden">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">打开数据源</h2>
            <p className="text-xs text-[var(--muted-fg)]">
              只读元数据 · 绝不读取业务数据行 · 凭据仅驻留内存不落地
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

        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 border-b border-[var(--border)] pb-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'graphql'}
            onClick={() => {
              setTab('graphql');
              setError(null);
            }}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
              tab === 'graphql'
                ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                : 'border border-[var(--border)] bg-[var(--sidebar)] text-[var(--fg)] hover:bg-[var(--secondary)]'
            }`}
          >
            GraphQL Schema（Saleor / Shopify）
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'sql_json'}
            onClick={() => {
              setTab('sql_json');
              setError(null);
            }}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
              tab === 'sql_json'
                ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                : 'border border-[var(--border)] bg-[var(--sidebar)] text-[var(--fg)] hover:bg-[var(--secondary)]'
            }`}
          >
            SQL DDL / Schema JSON / 压测
          </button>
        </div>

        <input
          ref={gqlFileInputRef}
          type="file"
          accept=".graphql,.gql,.json,text/plain,application/json"
          onChange={handleGqlFileChange}
          className="hidden"
        />

        {/* Tab 1: Track G4 GraphQL Schema (Saleor & Shopify) */}
        {tab === 'graphql' && (
          <div className="flex-1 min-h-0 overflow-y-auto relix-scroll flex flex-col gap-3 pr-0.5">
            {/* Saleor Card */}
            <section className="p-3 rounded-[8px] border border-[var(--border)] bg-[var(--sidebar)] flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Saleor GraphQL</h3>
                  <div className="text-[11px] text-[var(--muted-fg)]">
                    自动折叠 *CountableConnection 包装类型，并按 @doc(category) 自动分组
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--success)]/15 text-[var(--success)] text-[11px] font-medium">
                  <ShieldCheck className="w-3 h-3" />
                  是否读取业务数据：否
                </span>
              </div>

              <div className="text-[11px] text-[var(--muted-fg)] bg-[var(--popover)] border border-[var(--border)] rounded px-2.5 py-1.5">
                所需权限：仅需公开 Schema Introspection（或只读 App Token）；仅查询 <code>__schema</code> 类型定义。
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runLoad({ type: 'graphql_snapshot', provider: 'saleor' })}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-90 cursor-pointer disabled:opacity-50"
                >
                  加载 Saleor 官方核心快照（{SALEOR_SNAPSHOT_VERSION} · {SALEOR_SNAPSHOT_DATE}）
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    gqlUploadProviderRef.current = 'saleor';
                    gqlFileInputRef.current?.click();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border border-[var(--border)] bg-[var(--popover)] hover:bg-[var(--secondary)] cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  导入本地 .graphql / JSON
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1 border-t border-[var(--border)]/70">
                <input
                  type="url"
                  aria-label="Saleor GraphQL 端点地址"
                  value={saleorEndpoint}
                  onChange={(e) => setSaleorEndpoint(e.target.value)}
                  placeholder="https://your-saleor-host/graphql/"
                  className="sm:col-span-5 rounded border border-[var(--border)] bg-[var(--popover)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--primary)]"
                />
                <input
                  type="password"
                  aria-label="Saleor 可选只读 Bearer Token"
                  value={saleorToken}
                  onChange={(e) => setSaleorToken(e.target.value)}
                  placeholder="可选 Bearer Token（仅内存，不保存）"
                  className="sm:col-span-4 rounded border border-[var(--border)] bg-[var(--popover)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--primary)]"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleFetchSaleorLive}
                  className="sm:col-span-3 inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-[var(--border)] bg-[var(--popover)] hover:bg-[var(--secondary)] cursor-pointer disabled:opacity-50"
                >
                  <Globe className="w-3.5 h-3.5" />
                  在线读取内省
                </button>
              </div>
            </section>

            {/* Shopify Card */}
            <section className="p-3 rounded-[8px] border border-[var(--border)] bg-[var(--sidebar)] flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Shopify Admin GraphQL</h3>
                  <div className="text-[11px] text-[var(--muted-fg)]">
                    自动折叠 Relay *Connection / *Edge 包装类型，聚焦商品、订单、履约与库存实体
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--success)]/15 text-[var(--success)] text-[11px] font-medium">
                  <ShieldCheck className="w-3 h-3" />
                  是否读取业务数据：否
                </span>
              </div>

              <div className="text-[11px] text-[var(--muted-fg)] bg-[var(--popover)] border border-[var(--border)] rounded px-2.5 py-1.5">
                所需权限：官方快照与公共代理 <strong>免店铺、免 Token</strong>；直连店铺端点时仅需最小只读权限（Token 仅驻留内存）。
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runLoad({ type: 'graphql_snapshot', provider: 'shopify' })}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-90 cursor-pointer disabled:opacity-50"
                >
                  加载 Shopify 官方核心快照（{SHOPIFY_SNAPSHOT_VERSION} · {SHOPIFY_SNAPSHOT_DATE}）
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    gqlUploadProviderRef.current = 'shopify';
                    gqlFileInputRef.current?.click();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border border-[var(--border)] bg-[var(--popover)] hover:bg-[var(--secondary)] cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  导入本地 .graphql / JSON
                </button>
              </div>

              <div className="flex flex-col gap-2 pt-1 border-t border-[var(--border)]/70">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="shopify-mode"
                      checked={shopifyMode === 'public_proxy'}
                      onChange={() => setShopifyMode('public_proxy')}
                    />
                    官方公共 Schema 代理（免 Token）
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="shopify-mode"
                      checked={shopifyMode === 'store'}
                      onChange={() => setShopifyMode('store')}
                    />
                    指定店铺 Admin API
                  </label>
                  <label className="inline-flex items-center gap-1 ml-auto">
                    <span className="text-[var(--muted-fg)]">API 版本：</span>
                    <input
                      type="text"
                      aria-label="Shopify API 版本"
                      value={shopifyVersion}
                      onChange={(e) => setShopifyVersion(e.target.value)}
                      className="w-24 rounded border border-[var(--border)] bg-[var(--popover)] px-2 py-0.5 text-xs"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  {shopifyMode === 'store' ? (
                    <>
                      <input
                        type="text"
                        aria-label="Shopify 店铺域名"
                        value={shopifyStoreDomain}
                        onChange={(e) => setShopifyStoreDomain(e.target.value)}
                        placeholder="my-store.myshopify.com"
                        className="sm:col-span-5 rounded border border-[var(--border)] bg-[var(--popover)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--primary)]"
                      />
                      <input
                        type="password"
                        aria-label="Shopify X-Shopify-Access-Token"
                        value={shopifyToken}
                        onChange={(e) => setShopifyToken(e.target.value)}
                        placeholder="X-Shopify-Access-Token（仅内存）"
                        className="sm:col-span-4 rounded border border-[var(--border)] bg-[var(--popover)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--primary)]"
                      />
                    </>
                  ) : (
                    <div className="sm:col-span-9 text-[11px] text-[var(--muted-fg)] flex items-center px-2 py-1 rounded bg-[var(--popover)] border border-[var(--border)] truncate">
                      {SHOPIFY_PUBLIC_PROXY_BASE}/{shopifyVersion || '2026-10'}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleFetchShopifyLive}
                    className="sm:col-span-3 inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-[var(--border)] bg-[var(--popover)] hover:bg-[var(--secondary)] cursor-pointer disabled:opacity-50"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    在线读取内省
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Tab 2: SQL DDL / JSON / Benchmarks */}
        {tab === 'sql_json' && (
          <div className="flex-1 min-h-0 overflow-y-auto relix-scroll flex flex-col gap-3">
            {/* Local File Upload */}
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
                打开本地文件（.SQL / .DDL / .JSON — 浏览器端只读解析）
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={sqlFileInputRef}
                  type="file"
                  accept=".sql,.ddl,.json,text/plain,application/json"
                  onChange={handleSqlFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => sqlFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-[var(--border)] bg-[var(--sidebar)] hover:bg-[var(--secondary)] cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  选择 .sql 或 .json 文件...
                </button>
                <span className="text-xs text-[var(--muted-fg)]">
                  100% 本地解析，不联网上传任何结构或数据。
                </span>
              </div>
            </div>

            {/* Paste SQL / JSON */}
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold tracking-wider text-[var(--muted-fg)]">
                粘贴 SQL DDL 或已导出的 Schema JSON
              </div>
              <textarea
                aria-label="SQL DDL 或 Schema JSON 输入框"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="w-full h-[220px] p-2.5 rounded border border-[var(--border)] bg-[var(--bg)] font-mono text-xs text-[var(--fg)] resize-none focus:outline-none focus:border-[var(--primary)] relix-scroll"
              />
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runLoad({ type: 'bench', tables: 100 })}
                    className="px-2 py-1 rounded text-xs hover:bg-[var(--secondary)] text-[var(--muted-fg)] hover:text-[var(--fg)] cursor-pointer"
                  >
                    100 表压测
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runLoad({ type: 'bench', tables: 500 })}
                    className="px-2 py-1 rounded text-xs hover:bg-[var(--secondary)] text-[var(--muted-fg)] hover:text-[var(--fg)] cursor-pointer"
                  >
                    500 表压测
                  </button>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleParsePasted}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-90 cursor-pointer disabled:opacity-50"
                >
                  解析 SQL / JSON
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="p-2.5 rounded-[6px] bg-[var(--danger)]/15 border border-[var(--danger)]/35 text-xs text-[var(--danger)] break-words"
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
};
