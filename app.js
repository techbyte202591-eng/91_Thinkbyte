// minimal working UI
(function () {
  const $ = (id) => document.getElementById(id);
  const out = $("out");
  const urlInput = $("url");
  const keyInput = $("apiKey");

  const btn = (id, fn) => $(id).addEventListener("click", fn);

  async function call(path) {
    const key = (keyInput.value || "").trim();
    const res = await fetch(path, { headers: key ? { "x-api-key": key } : {} });
    const txt = await res.text();
    try { return res.ok ? JSON.parse(txt) : Promise.reject(new Error(txt)); }
    catch { throw new Error(txt); }
  }

  btn("btnScrape", async () => {
    try {
      const u = encodeURIComponent(urlInput.value.trim());
      const data = await call(`/scrape?url=${u}`);
      out.textContent = JSON.stringify(data, null, 2);
    } catch (e) { alert(e.message); }
  });

  btn("btnAudit", async () => {
    try {
      const u = encodeURIComponent(urlInput.value.trim());
      const data = await call(`/audit/full?url=${u}`);
      out.textContent = JSON.stringify(data, null, 2);
    } catch (e) { alert(e.message); }
  });

  btn("btnShot", async () => {
    try {
      const u = encodeURIComponent(urlInput.value.trim());
      const data = await call(`/screenshot?url=${u}`);
      out.textContent = JSON.stringify(data, null, 2);
      alert("Saved: " + data.file);
    } catch (e) { alert(e.message); }
  });

  btn("btnJSON", () => {
    const key = (keyInput.value || "").trim();
    window.open(key ? `/export/json?key=${encodeURIComponent(key)}` : `/export/json`, "_blank");
  });
  btn("btnCSV", () => {
    const key = (keyInput.value || "").trim();
    window.open(key ? `/export/csv?key=${encodeURIComponent(key)}` : `/export/csv`, "_blank");
  });
  btn("btnPDF", () => {
    const key = (keyInput.value || "").trim();
    window.open(key ? `/export/pdf?key=${encodeURIComponent(key)}` : `/export/pdf`, "_blank");
  });

  // remember key
  keyInput.value = localStorage.getItem("apiKey") || "";
  keyInput.addEventListener("input", () => localStorage.setItem("apiKey", keyInput.value.trim()));
})();
