/// Redact passwords/credentials from database connection strings before logging,
/// displaying in the UI, or embedding in error messages.
pub fn redact_connection_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.contains("://") {
        redact_uri(trimmed)
    } else {
        redact_kv_dsn(trimmed)
    }
}

fn redact_uri(uri: &str) -> String {
    let Some(scheme_end) = uri.find("://") else {
        return uri.to_string();
    };
    let prefix = &uri[..scheme_end + 3];
    let rest = &uri[scheme_end + 3..];

    // Authority ends at the first '/', '?', or '#'
    let auth_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..auth_end];
    let suffix = &rest[auth_end..];

    // Use the LAST '@' in authority so '@' inside a password is still handled.
    let Some(at_pos) = authority.rfind('@') else {
        return redact_query_password(uri);
    };

    let userinfo = &authority[..at_pos];
    let hostpart = &authority[at_pos + 1..];

    let redacted_userinfo = match userinfo.find(':') {
        Some(colon) => format!("{}:***", &userinfo[..colon]),
        None => userinfo.to_string(),
    };

    let rebuilt = format!("{prefix}{redacted_userinfo}@{hostpart}{suffix}");
    redact_query_password(&rebuilt)
}

fn redact_query_password(uri: &str) -> String {
    let Some(q_pos) = uri.find('?') else {
        return uri.to_string();
    };
    let (base, query) = uri.split_at(q_pos + 1);
    let redacted_params: Vec<String> = query
        .split('&')
        .map(|param| {
            if let Some((k, _v)) = param.split_once('=') {
                let lower = k.to_ascii_lowercase();
                if lower == "password" || lower == "pass" {
                    return format!("{k}=***");
                }
            }
            param.to_string()
        })
        .collect();
    format!("{base}{}", redacted_params.join("&"))
}

fn redact_kv_dsn(dsn: &str) -> String {
    let mut out = String::with_capacity(dsn.len());
    let bytes = dsn.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        // Copy whitespace
        if bytes[i].is_ascii_whitespace() {
            out.push(bytes[i] as char);
            i += 1;
            continue;
        }

        // Parse key=value (value may be single-quoted)
        let start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'=' {
            i += 1;
        }
        let key = &dsn[start..i];

        if i < bytes.len() && bytes[i] == b'=' {
            i += 1; // skip '='
            let val_start = i;
            if i < bytes.len() && (bytes[i] == b'\'' || bytes[i] == b'"') {
                let quote = bytes[i];
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\\' && i + 1 < bytes.len() {
                        i += 2;
                    } else if bytes[i] == quote {
                        i += 1;
                        break;
                    } else {
                        i += 1;
                    }
                }
            } else {
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
            }

            let lower_key = key.to_ascii_lowercase();
            if lower_key == "password" || lower_key == "pass" {
                out.push_str(key);
                out.push_str("=***");
            } else {
                out.push_str(key);
                out.push('=');
                out.push_str(&dsn[val_start..i]);
            }
        } else {
            out.push_str(key);
        }
    }

    out
}

/// Derive a credential-free, deterministic config key from a Postgres connection string
/// using only host, port, and database name (never username or password).
pub fn postgres_config_key(raw: &str) -> String {
    let (host, port, dbname) = extract_host_port_db(raw.trim());
    let canonical = format!("{}:{}/{}", host.to_ascii_lowercase(), port, dbname);

    const FNV_OFFSET: u128 = 0x6c62_272e_07bb_0142_62b8_2175_6295_c58d;
    const FNV_PRIME: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013b;
    let mut hash = FNV_OFFSET;
    for &b in canonical.as_bytes() {
        hash ^= u128::from(b);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("pg_{hash:032x}")
}

fn extract_host_port_db(raw: &str) -> (String, String, String) {
    if let Some(scheme_end) = raw.find("://") {
        let rest = &raw[scheme_end + 3..];
        let auth_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
        let authority = &rest[..auth_end];
        let after_auth = &rest[auth_end..];

        let hostport = authority
            .rfind('@')
            .map(|idx| &authority[idx + 1..])
            .unwrap_or(authority);

        let (host, port) = split_host_port(hostport);
        let db = after_auth
            .strip_prefix('/')
            .unwrap_or("")
            .split(['?', '#'])
            .next()
            .unwrap_or("")
            .to_string();

        (
            if host.is_empty() {
                "localhost".to_string()
            } else {
                host
            },
            if port.is_empty() {
                "5432".to_string()
            } else {
                port
            },
            if db.is_empty() {
                "postgres".to_string()
            } else {
                db
            },
        )
    } else {
        let mut host = "localhost".to_string();
        let mut port = "5432".to_string();
        let mut dbname = "postgres".to_string();
        for token in raw.split_whitespace() {
            if let Some((k, v)) = token.split_once('=') {
                let v_clean = v.trim_matches('\'').trim_matches('"');
                match k.to_ascii_lowercase().as_str() {
                    "host" | "hostaddr" if !v_clean.is_empty() => host = v_clean.to_string(),
                    "port" if !v_clean.is_empty() => port = v_clean.to_string(),
                    "dbname" if !v_clean.is_empty() => dbname = v_clean.to_string(),
                    _ => {}
                }
            }
        }
        (host, port, dbname)
    }
}

fn split_host_port(hostport: &str) -> (String, String) {
    if hostport.starts_with('[') {
        // IPv6 `[::1]:5432`
        if let Some(close) = hostport.find(']') {
            let host = &hostport[1..close];
            let port = hostport[close + 1..]
                .strip_prefix(':')
                .unwrap_or("")
                .to_string();
            return (host.to_string(), port);
        }
    }
    match hostport.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.to_string()),
        None => (hostport.to_string(), String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_uri_passwords_including_special_chars() {
        assert_eq!(
            redact_connection_url(
                "postgres://alice:s3cr3t@db.example.com:5432/prod?sslmode=require"
            ),
            "postgres://alice:***@db.example.com:5432/prod?sslmode=require"
        );
        assert_eq!(
            redact_connection_url("postgresql://bob:p@ss:word@127.0.0.1/app"),
            "postgresql://bob:***@127.0.0.1/app"
        );
        assert_eq!(
            redact_connection_url(
                "postgres://alice@localhost:5432/app?password=secret&sslmode=disable"
            ),
            "postgres://alice@localhost:5432/app?password=***&sslmode=disable"
        );
        assert_eq!(
            redact_connection_url("postgres://localhost/mydb"),
            "postgres://localhost/mydb"
        );
    }

    #[test]
    fn redacts_kv_dsn_passwords() {
        assert_eq!(
            redact_connection_url(
                "host=localhost port=5432 user=postgres password=mysecret dbname=shop"
            ),
            "host=localhost port=5432 user=postgres password=*** dbname=shop"
        );
        assert_eq!(
            redact_connection_url("host=db.local user=admin password='my secret' dbname=app"),
            "host=db.local user=admin password=*** dbname=app"
        );
    }

    #[test]
    fn config_key_ignores_credentials_and_matches_host_port_db() {
        let k1 =
            postgres_config_key("postgres://alice:pass1@db.example.com:5432/shop?sslmode=require");
        let k2 = postgres_config_key("postgres://bob:pass2@db.example.com:5432/shop");
        let k3 =
            postgres_config_key("host=db.example.com port=5432 user=carol password=x dbname=shop");
        let k_other = postgres_config_key("postgres://alice:pass1@db.example.com:5432/other_db");

        assert_eq!(k1, k2);
        assert_eq!(k1, k3);
        assert_ne!(k1, k_other);
        assert!(k1.starts_with("pg_"));
    }
}
