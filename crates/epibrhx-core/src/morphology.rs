/// Configuration for identifier morphology & prefix normalization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MorphologyConfig {
    /// Table name prefixes to strip when matching stems (case-insensitive).
    pub table_prefixes: Vec<String>,
}

impl Default for MorphologyConfig {
    fn default() -> Self {
        Self {
            table_prefixes: vec!["tbl_".to_string(), "t_".to_string()],
        }
    }
}

/// Extracted stem and hint from a foreign-key-like column name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnStem {
    /// Normalized snake_case stem (e.g. `"user"` from `"user_id"`, `"order_item"` from `"orderItemId"`).
    pub stem: String,
    /// Original suffix matched (e.g. `"_id"`, `"Id"`, `"_uuid"`, `"Uuid"`).
    pub suffix: &'static str,
}

/// Extract `<x>` stem from column names matching `<x>_id`, `<x>Id`, `<x>_uuid`, or `<x>Uuid`.
pub fn extract_fk_stem(col_name: &str) -> Option<ColumnStem> {
    if let Some(prefix) = strip_suffix_ci(col_name, "_uuid")
        && !prefix.is_empty()
    {
        return Some(ColumnStem {
            stem: to_snake_case(prefix),
            suffix: "_uuid",
        });
    }
    if let Some(prefix) = col_name.strip_suffix("Uuid")
        && !prefix.is_empty()
    {
        return Some(ColumnStem {
            stem: to_snake_case(prefix),
            suffix: "Uuid",
        });
    }
    if let Some(prefix) = strip_suffix_ci(col_name, "_id")
        && !prefix.is_empty()
    {
        return Some(ColumnStem {
            stem: to_snake_case(prefix),
            suffix: "_id",
        });
    }
    if let Some(prefix) = col_name.strip_suffix("Id")
        && !prefix.is_empty()
    {
        return Some(ColumnStem {
            stem: to_snake_case(prefix),
            suffix: "Id",
        });
    }
    None
}

fn strip_suffix_ci<'a>(s: &'a str, suffix: &str) -> Option<&'a str> {
    if s.len() <= suffix.len() {
        return None;
    }
    let split = s.len() - suffix.len();
    if s.is_char_boundary(split) && s[split..].eq_ignore_ascii_case(suffix) {
        Some(&s[..split])
    } else {
        None
    }
}

/// Convert camelCase / PascalCase / mixed identifiers into lowercase `snake_case`.
pub fn to_snake_case(ident: &str) -> String {
    let mut out = String::with_capacity(ident.len() + 4);
    let chars: Vec<char> = ident.chars().collect();
    for (i, &ch) in chars.iter().enumerate() {
        if ch.is_uppercase() {
            let prev_is_lower_or_digit =
                i > 0 && (chars[i - 1].is_lowercase() || chars[i - 1].is_ascii_digit());
            let next_is_lower = i + 1 < chars.len() && chars[i + 1].is_lowercase();
            let prev_is_upper = i > 0 && chars[i - 1].is_uppercase();
            if (prev_is_lower_or_digit || (prev_is_upper && next_is_lower))
                && !out.ends_with('_')
                && !out.is_empty()
            {
                out.push('_');
            }
            for lc in ch.to_lowercase() {
                out.push(lc);
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// Strip configured prefixes (e.g. `tbl_`, `t_`) from a table name and normalize to snake_case.
pub fn normalize_table_stem(table_name: &str, prefixes: &[String]) -> String {
    let snake = to_snake_case(table_name);
    for prefix in prefixes {
        let p_lower = prefix.to_ascii_lowercase();
        if let Some(rest) = snake.strip_prefix(&p_lower)
            && !rest.is_empty()
        {
            return rest.to_string();
        }
    }
    snake
}

/// Return true if a column stem and a (prefix-stripped) table name match via identity or singular/plural equivalence.
pub fn stems_match(col_stem: &str, table_stem: &str) -> bool {
    let a = to_snake_case(col_stem);
    let b = to_snake_case(table_stem);
    if a == b {
        return true;
    }

    // Compare the last snake_case word (e.g., `line_item` <-> `line_items`, `blog_category` <-> `blog_categories`)
    let (a_head, a_tail) = split_last_segment(&a);
    let (b_head, b_tail) = split_last_segment(&b);
    if a_head != b_head {
        return false;
    }

    singularize(a_tail) == singularize(b_tail)
}

fn split_last_segment(snake: &str) -> (&str, &str) {
    match snake.rsplit_once('_') {
        Some((head, tail)) => (head, tail),
        None => ("", snake),
    }
}

/// Normalize an English noun (single lowercase word) to its singular form.
pub fn singularize(word: &str) -> String {
    let w = word.to_ascii_lowercase();
    if let Some(irr) = irregular_singular(&w) {
        return irr.to_string();
    }

    if w.len() > 4 && w.ends_with("ies") {
        // e.g. categories -> category, companies -> company
        return format!("{}y", &w[..w.len() - 3]);
    }
    if w.len() > 4 && w.ends_with("ves") {
        // e.g. leaves -> leaf, knives -> knife (normalize both to `-f` stem? Check common -fe/-f)
        let stem = &w[..w.len() - 3];
        if stem == "kni" || stem == "wi" || stem == "li" {
            return format!("{stem}fe");
        }
        return format!("{stem}f");
    }
    if w.len() > 4
        && (w.ends_with("ches")
            || w.ends_with("shes")
            || w.ends_with("xes")
            || w.ends_with("zes")
            || w.ends_with("ses"))
    {
        // e.g. statuses -> status, addresses -> address, boxes -> box, matches -> match
        return w[..w.len() - 2].to_string();
    }
    if w.len() > 2
        && w.ends_with('s')
        && !w.ends_with("ss")
        && !w.ends_with("us")
        && !w.ends_with("is")
    {
        // e.g. users -> user, orders -> order (while preserving `status`, `address`, `analysis`)
        return w[..w.len() - 1].to_string();
    }

    w
}

fn irregular_singular(word: &str) -> Option<&'static str> {
    match word {
        "people" | "person" => Some("person"),
        "children" | "child" => Some("child"),
        "men" | "man" => Some("man"),
        "women" | "woman" => Some("woman"),
        "mice" | "mouse" => Some("mouse"),
        "geese" | "goose" => Some("goose"),
        "teeth" | "tooth" => Some("tooth"),
        "feet" | "foot" => Some("foot"),
        "data" | "datum" => Some("datum"),
        "indices" | "index" => Some("index"),
        "criteria" | "criterion" => Some("criterion"),
        "statuses" | "status" => Some("status"),
        "quizzes" | "quiz" => Some("quiz"),
        "oxen" | "ox" => Some("ox"),
        "media" | "medium" => Some("medium"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_snake_and_camel_fk_stems() {
        assert_eq!(
            extract_fk_stem("user_id"),
            Some(ColumnStem {
                stem: "user".to_string(),
                suffix: "_id"
            })
        );
        assert_eq!(
            extract_fk_stem("personId"),
            Some(ColumnStem {
                stem: "person".to_string(),
                suffix: "Id"
            })
        );
        assert_eq!(
            extract_fk_stem("orderItemId"),
            Some(ColumnStem {
                stem: "order_item".to_string(),
                suffix: "Id"
            })
        );
        assert_eq!(
            extract_fk_stem("person_uuid"),
            Some(ColumnStem {
                stem: "person".to_string(),
                suffix: "_uuid"
            })
        );
        assert_eq!(extract_fk_stem("id"), None);
        assert_eq!(extract_fk_stem("created_at"), None);
    }

    #[test]
    fn matches_singular_plural_irregular_and_prefixes() {
        let prefixes = vec!["tbl_".to_string(), "t_".to_string()];
        assert!(stems_match(
            "user",
            &normalize_table_stem("users", &prefixes)
        ));
        assert!(stems_match(
            "category",
            &normalize_table_stem("categories", &prefixes)
        ));
        assert!(stems_match(
            "person",
            &normalize_table_stem("tbl_people", &prefixes)
        ));
        assert!(stems_match(
            "line_item",
            &normalize_table_stem("t_line_items", &prefixes)
        ));
        assert!(stems_match(
            "status",
            &normalize_table_stem("statuses", &prefixes)
        ));
        assert!(!stems_match(
            "author",
            &normalize_table_stem("users", &prefixes)
        ));
    }
}
