async function init() {
  const loadingEl = document.getElementById('loading');

  try {
    const wasm = await import('./wasm/epibrhx_app.js');
    await wasm.default();
    const benchParam = new URLSearchParams(window.location.search).get('bench');
    const benchTables = benchParam ? Number.parseInt(benchParam, 10) : undefined;
    await wasm.run(Number.isFinite(benchTables) ? benchTables : undefined);
    loadingEl?.remove();
  } catch (error) {
    console.error('Failed to initialize EPIBRHX WASM:', error);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="error">
          <h2>Failed to load EPIBRHX WASM</h2>
          <p>${error?.message || error}</p>
        </div>
      `;
    }
  }
}

init();
