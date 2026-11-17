//! Core unified schema model, deterministic relation inference, and exporters.
//! Pure computation crate with no UI or OS I/O dependencies; compiles to `wasm32-unknown-unknown`.

pub fn core_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_non_empty() {
        assert!(!core_version().is_empty());
    }
}
