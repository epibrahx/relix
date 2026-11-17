//! Pure graph layout algorithms for ER diagrams; compiles to `wasm32-unknown-unknown`.

pub fn layout_ready() -> bool {
    !epibrhx_core::core_version().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_links_core() {
        assert!(layout_ready());
    }
}
