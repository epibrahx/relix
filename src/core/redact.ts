/**
 * Redact passwords, API tokens, and credentials from database connection strings
 * and error messages before logging, displaying in UI, or exporting.
 */
export function redactConnectionUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  let out = trimmed;

  // Redact any embedded URI credentials anywhere in a message (e.g., "failed to connect postgres://u:p@host/db")
  out = out.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s/@"'<>]+@[^\s"'<>]+)/g,
    (_full, scheme: string, rest: string) => redactUri(`${scheme}${rest}`),
  );

  // Redact standalone KV DSN passwords
  out = redactKvDsn(out);

  // Redact Bearer / Shopify tokens / header secrets
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{4,}/gi, '$1***');
  out = out.replace(/\b(shpat|shpca|shppa|shpua|sk|pk)_[A-Za-z0-9_-]{4,}\b/gi, '$1_***');
  out = out.replace(
    /((?:X-Shopify-Access-Token|Authorization|access_token|api_key|apikey|token|secret)\s*[:=]\s*['"]?)([^\s'",;&]+)/gi,
    '$1***',
  );

  return out;
}

export function redactSecrets(raw: string, extraTokens: string[] = []): string {
  let out = redactConnectionUrl(raw);
  for (const tok of extraTokens) {
    const clean = tok.trim();
    if (clean.length >= 3) {
      out = out.split(clean).join('***');
    }
  }
  return out;
}

function redactUri(uri: string): string {
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd < 0) return uri;

  const prefix = uri.slice(0, schemeEnd + 3);
  const rest = uri.slice(schemeEnd + 3);

  let authEnd = rest.length;
  for (const sep of ['/', '?', '#']) {
    const idx = rest.indexOf(sep);
    if (idx >= 0 && idx < authEnd) authEnd = idx;
  }

  const authority = rest.slice(0, authEnd);
  const suffix = rest.slice(authEnd);

  const atPos = authority.lastIndexOf('@');
  if (atPos < 0) {
    return redactQueryPassword(uri);
  }

  const userinfo = authority.slice(0, atPos);
  const hostpart = authority.slice(atPos + 1);
  const colonPos = userinfo.indexOf(':');
  const redactedUserinfo = colonPos >= 0 ? `${userinfo.slice(0, colonPos)}:***` : userinfo;

  const rebuilt = `${prefix}${redactedUserinfo}@${hostpart}${suffix}`;
  return redactQueryPassword(rebuilt);
}

function redactQueryPassword(uri: string): string {
  const qPos = uri.indexOf('?');
  if (qPos < 0) return uri;
  const base = uri.slice(0, qPos + 1);
  const query = uri.slice(qPos + 1);
  const redacted = query
    .split('&')
    .map((param) => {
      const eq = param.indexOf('=');
      if (eq >= 0) {
        const k = param.slice(0, eq);
        const lower = k.toLowerCase();
        if (lower === 'password' || lower === 'pass' || lower === 'token' || lower === 'apikey') {
          return `${k}=***`;
        }
      }
      return param;
    })
    .join('&');
  return `${base}${redacted}`;
}

function redactKvDsn(dsn: string): string {
  let out = '';
  let i = 0;
  while (i < dsn.length) {
    if (/\s/.test(dsn[i])) {
      out += dsn[i];
      i += 1;
      continue;
    }
    const start = i;
    while (i < dsn.length && !/\s/.test(dsn[i]) && dsn[i] !== '=') {
      i += 1;
    }
    const key = dsn.slice(start, i);
    if (i < dsn.length && dsn[i] === '=') {
      i += 1;
      const valStart = i;
      if (i < dsn.length && (dsn[i] === "'" || dsn[i] === '"')) {
        const quote = dsn[i];
        i += 1;
        while (i < dsn.length) {
          if (dsn[i] === '\\' && i + 1 < dsn.length) {
            i += 2;
          } else if (dsn[i] === quote) {
            i += 1;
            break;
          } else {
            i += 1;
          }
        }
      } else {
        while (i < dsn.length && !/\s/.test(dsn[i])) {
          i += 1;
        }
      }
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'password' || lowerKey === 'pass' || lowerKey === 'pgpassword') {
        out += `${key}=***`;
      } else {
        out += `${key}=${dsn.slice(valStart, i)}`;
      }
    } else {
      out += key;
    }
  }
  return out;
}

export interface ErrorClassificationContext {
  provider?: 'postgres' | 'saleor' | 'shopify' | 'graphql' | 'sql';
  status?: number;
  secretTokens?: string[];
  isBrowserCorsLikely?: boolean;
}

/**
 * Track A5 & G4: Categorize connection/auth/SSL/CORS/rate-limit/empty-db errors
 * into clear Chinese guidance while strictly redacting all passwords and tokens.
 */
export function classifyConnectionError(
  rawErr: unknown,
  ctx: ErrorClassificationContext = {},
): string {
  const rawMsg = rawErr instanceof Error ? rawErr.message : String(rawErr ?? '');
  const safeMsg = redactSecrets(rawMsg, ctx.secretTokens);
  const lower = safeMsg.toLowerCase();

  if (ctx.status === 401 || lower.includes('password authentication failed') || lower.includes('28p01') || lower.includes('invalid token') || lower.includes('unauthorized')) {
    return `凭据无效或密码错误：请检查账号、密码或访问 Token 是否正确（凭据已脱敏，未写入本地）。详情：${safeMsg}`;
  }
  if (ctx.status === 403 || lower.includes('permission denied') || lower.includes('42501') || lower.includes('forbidden') || lower.includes('access denied')) {
    return `权限不足：当前凭据缺少读取 Schema 元数据的只读权限，请检查只读授权范围。详情：${safeMsg}`;
  }
  if (ctx.status === 429 || lower.includes('too many requests') || lower.includes('rate limit') || lower.includes('throttled')) {
    return `请求触发限流（HTTP 429）：请稍后重试，或直接导入本地导出的 SDL / Introspection 文件。详情：${safeMsg}`;
  }
  if (lower.includes('certificate') || lower.includes('self signed') || lower.includes('tls') || lower.includes('x509')) {
    return `TLS / 证书校验失败：服务端证书不受信任或主机名不匹配，请检查 CA 证书配置或 sslmode 参数。详情：${safeMsg}`;
  }
  if (lower.includes('sslmode') || lower.includes('no pg_hba.conf entry') || lower.includes('ssl is required') || lower.includes('server does not support ssl')) {
    return `sslmode 不匹配：服务端与客户端的 SSL 要求不一致（例如托管库通常需要 sslmode=require）。详情：${safeMsg}`;
  }
  if (lower.includes('empty') || lower.includes('no tables') || lower.includes('库为空') || lower.includes('0 tables')) {
    return `目标库为空：未检测到任何表、视图或实体类型，请确认已选择正确的 schema 或文件。`;
  }
  if (
    ctx.isBrowserCorsLikely ||
    lower.includes('cors') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed')
  ) {
    const providerHint =
      ctx.provider === 'saleor' || ctx.provider === 'shopify' || ctx.provider === 'graphql'
        ? '浏览器版受目标站点 CORS 跨域限制，无法直连该端点；请点击「加载官方快照」、上传本地导出的 .graphql / Introspection JSON 文件，或在桌面端连接。'
        : '网络连接失败或受浏览器跨域（CORS）限制：请检查地址是否可达、端口与防火墙设置。';
    return `端点不可用或 CORS 受限：${providerHint}`;
  }
  if (lower.includes('econnrefused') || lower.includes('etimedout') || lower.includes('enotfound') || lower.includes('timeout')) {
    return `无法连接到目标端点：主机不可达、端口未开放或连接超时，请检查地址与网络连通性。详情：${safeMsg}`;
  }

  return `加载失败：${safeMsg || '未知错误'}`;
}
