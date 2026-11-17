//! Native schema loaders for SQLite, PostgreSQL, and SQL DDL files.

pub fn sources_ready() -> bool {
    !epibrhx_core::core_version().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sources_links_core() {
        assert!(sources_ready());
    }
}
