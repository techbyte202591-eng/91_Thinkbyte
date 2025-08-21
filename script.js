(() => {
  const $  = (sel, p=document) => p.querySelector(sel);
  const $$ = (sel, p=document) => [...p.querySelectorAll(sel)];

  // ---- API base & safe fetch ----
  const API_BASE = (location.protocol === "file:")
    ? "http://localhost:3000"   // opened as file:/// → talk to local server
    : location.origin;          // same origin (localhost, LAN IP, ngrok, etc.)

  async function fetchJSON(path, options = {}) {
    const url = path.startsWith("http") ? path : API_BASE + path;
    const res = await fetch(url, options);
    const ct = res.headers.get("content-type") || "";
    const text = await res.text(); // read once
    if (ct.includes("application/json")) {
      try {
        const json = JSON.parse(text);
        return { ok: res.ok, status: res.status, data: json, raw: text };
      } catch (e) {
        return { ok: false, status: res.status, error: "JSON parse failed", raw: text };
      }
    } else {
      return { ok: res.ok, status: res.status, error: "Non-JSON response", raw: text };
    }
  }

  // Elements
  const statusBadge = $("#status-badge");
  const logEl = $("#log");
  const btnRefresh = $("#btn-refresh");
  const btnClearLog = $("#btn-clear-log");
  const toastEl = $("#toast");

  const apiKeyInput = $("#api-key");
  const btnSaveKey = $("#btn-save-key");
  const btnRemoveKey = $("#btn-remove-key");
  const keyStatus = $("#key-status");
  const btnTestApi = $("#btn-test-api");
  const testOutput = $("#test-output");

  const auditUrl = $("#audit-url");
  const btnScrape = $("#btn-scrape");
  const btnRunAudit = $("#btn-run-audit");
  const btnExportJSON = $("#btn-export-json");
  const btnExportCSV  = $("#btn-export-csv");
  const btnExportPDF  = $("#btn-export-pdf");
  const btnScreenshot = $("#btn-screenshot");

  const auditBadge = $("#audit-badge");
  const auditSummary = $("#audit-summary");
  const jsonOutput = $("#json-output");
  const outputPanel = $("#output-panel");
  const auditIssues = $("#audit-issues");
  const yearEl = $("#year");

  const toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1600);
  };

  const setBadge = (label, cls) => {
    if (!statusBadge) return;
    statusBadge.textContent = label;
    statusBadge.className = "badge " + cls;
  };

  const addLog = (msg, data) => {
    if (!logEl) return;
    const time = new Date().toLocaleTimeString();
    logEl.textContent += `[${time}] ${msg}\n`;
    if (data) logEl.textContent += JSON.stringify(data, null, 2) + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  };

  // Tabs
  const initTabs = () => {
    const links = $$(".nav-link");
    const panels = $$("[data-tab-panel]");
    links.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const tab = link.getAttribute("data-tab");
        links.forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
        panels.forEach((p) => (p.hidden = p.getAttribute("data-tab-panel") !== tab));
      });
    });
  };

  // Health
  const ping = async () => {
    setBadge("Checking…", "muted");
    try {
      const r = await fetchJSON("/api/hello");
      if (!r.ok) throw new Error(`${r.status} ${r.error || r.raw}`);
      addLog("OK /api/hello", r.data);
      setBadge("Online", "ok");
      return r.data;
    } catch (err) {
      addLog("ERR /api/hello", { error: String(err) });
      setBadge("Offline", "err");
      return null;
    }
  };

  // API key
  const getApiKey = () => localStorage.getItem("APP_API_KEY") || "";
  const setApiKey = (v) => localStorage.setItem("APP_API_KEY", v);
  const clearApiKey = () => localStorage.removeItem("APP_API_KEY");

  const initKey = () => {
    if (!apiKeyInput || !keyStatus) return;
    const saved = getApiKey();
    apiKeyInput.value = saved;
    keyStatus.textContent = saved ? "Key is saved locally." : "No key saved.";
  };

  const testRequest = async () => {
    if (!testOutput) return;
    testOutput.textContent = "Requesting…";
    const r = await fetchJSON("/api/hello");
    if (r.ok) {
      testOutput.textContent = JSON.stringify(r.data, null, 2);
      toast("Request succeeded");
    } else {
      testOutput.textContent = r.error || r.raw || "Failed";
      toast("Request failed");
    }
  };

  // Buttons (Home/Tools)
  btnRefresh?.addEventListener("click", ping);
  btnClearLog?.addEventListener("click", () => (logEl.textContent = ""));
  btnSaveKey?.addEventListener("click", () => { setApiKey(apiKeyInput.value.trim()); initKey(); toast("Key saved"); });
  btnRemoveKey?.addEventListener("click", () => { clearApiKey(); initKey(); apiKeyInput.value = ""; toast("Key removed"); });
  btnTestApi?.addEventListener("click", testRequest);

  // Audit helpers
  const pill = (label, score) => {
    const cls = score >= 90 ? "good" : score >= 60 ? "ok" : "bad";
    return `<span class="score-pill ${cls}">${label}: ${score}</span>`;
  };
  let lastJSON = null;

  const setOutput = (obj) => {
    lastJSON = obj;
    if (jsonOutput) jsonOutput.textContent = JSON.stringify(obj, null, 2);
  };

  // SCRAPE
  const runScrape = async () => {
    const url = (auditUrl?.value || "").trim();
    if (!url) { toast("Enter a URL"); return; }
    if (auditBadge) { auditBadge.textContent = "Scraping…"; auditBadge.className = "badge muted"; }
    auditSummary.innerHTML = "";
    auditIssues.innerHTML = "";
    setOutput({});

    const r = await fetchJSON("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });

    if (r.ok && r.data?.success) {
      setOutput(r.data);
      auditBadge.textContent = "Done"; auditBadge.className = "badge ok";
      toast("Scrape complete");
    } else {
      auditBadge.textContent = "Error"; auditBadge.className = "badge err";
      setOutput({ success:false, status:r.status, error:r.error || r.data?.error, raw:r.raw });
      toast("Scrape failed");
    }
  };

  // FULL AUDIT
  const runAudit = async () => {
    const url = (auditUrl?.value || "").trim();
    if (!url) { toast("Enter a URL"); return; }
    if (auditBadge) { auditBadge.textContent = "Running…"; auditBadge.className = "badge muted"; }
    auditSummary.innerHTML = "";
    auditIssues.innerHTML = "";
    setOutput({});

    const r = await fetchJSON("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });

    if (r.ok && r.data?.success !== false && !r.data?.error) {
      const data = r.data;

      const pills = (data.categories || []).map(c => pill(c.label, c.score)).join(" ");
      const overall = pill("Overall", data.overall ?? 0);
      auditSummary.innerHTML = `<div class="row gap">${overall} ${pills}</div>`;

      if ((data.issues || []).length === 0) {
        auditIssues.innerHTML = `<div class="issue"><div class="title">No issues found 🎉</div></div>`;
      } else {
        auditIssues.innerHTML = data.issues.map(i => `
          <div class="issue">
            <div class="area">${i.area} — <span class="muted">${i.severity || "info"}</span></div>
            <div class="title">${i.title}</div>
            ${i.details ? `<div class="muted" style="margin-bottom:6px">${i.details}</div>` : ""}
            ${i.fix ? `<div class="fix"><strong>Fix:</strong> ${i.fix}</div>` : ""}
          </div>
        `).join("");
      }

      setOutput(data);
      auditBadge.textContent = "Done"; auditBadge.className = "badge ok";
      toast("Audit complete");
    } else {
      auditBadge.textContent = "Error"; auditBadge.className = "badge err";
      setOutput({ success:false, status:r.status, error:r.error || r.data?.error, raw:r.raw });
      auditIssues.innerHTML = `<div class="issue"><div class="title">Error</div><div class="muted">${(r.error||r.data?.error)||"See Output panel"}</div></div>`;
      toast("Audit failed");
    }
  };

  // Screenshot of the Output panel (PNG)
  const takeScreenshot = async () => {
    try {
      if (!window.html2canvas) { toast("html2canvas not loaded"); return; }
      const node = outputPanel || document.body;
      const canvas = await window.html2canvas(node, { useCORS: true, backgroundColor: null, scale: 2 });
      const dataURL = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataURL;
      a.download = `screenshot_${new Date().toISOString().replace(/[:.]/g,"-")}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      toast("Screenshot saved");
    } catch (e) {
      toast("Screenshot failed");
    }
  };

  // Export JSON
  const exportJSON = () => {
    if (!lastJSON) { toast("Nothing to export"); return; }
    const blob = new Blob([JSON.stringify(lastJSON, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `output_${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  // Export CSV (issues only)
  const exportCSV = () => {
    if (!lastJSON || !Array.isArray(lastJSON.issues)) { toast("No issues to export"); return; }
    const rows = [
      ["area","title","severity","details","fix"],
      ...lastJSON.issues.map(i => [
        (i.area||"").replace(/"/g,'""'),
        (i.title||"").replace(/"/g,'""'),
        (i.severity||"").replace(/"/g,'""'),
        (i.details||"").replace(/"/g,'""'),
        (i.fix||"").replace(/"/g,'""'),
      ])
    ];
    const csv = rows.map(r => r.map(x=>`"${x}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `issues_${new Date().toISOString().replace(/[:.]/g,"-")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  // Export PDF (screenshot of panel)
  const exportPDF = async () => {
    try {
      if (!window.html2canvas) { toast("html2canvas not loaded"); return; }
      if (!window.jspdf || !window.jspdf.jsPDF) { toast("jsPDF not loaded"); return; }

      const node = outputPanel || document.body;
      const canvas = await window.html2canvas(node, { useCORS: true, backgroundColor: "#0c1424", scale: 2 });
      const imgData = canvas.toDataURL("image/png");

      const pdf = new window.jspdf.jsPDF({ orientation: "p", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = pageWidth - 48; // margins
      const ratio = canvas.height / canvas.width;
      const imgHeight = imgWidth * ratio;

      pdf.setFillColor(12,20,36);
      pdf.rect(0,0,pageWidth,pageHeight,"F");

      pdf.addImage(imgData, "PNG", 24, 24, imgWidth, imgHeight);
      pdf.save(`audit_${new Date().toISOString().replace(/[:.]/g,"-")}.pdf`);
      toast("PDF exported");
    } catch (e) {
      toast("PDF export failed");
    }
  };

  // Wire audit buttons
  btnScrape?.addEventListener("click", runScrape);
  btnRunAudit?.addEventListener("click", runAudit);
  btnExportJSON?.addEventListener("click", exportJSON);
  btnExportCSV?.addEventListener("click", exportCSV);
  btnExportPDF?.addEventListener("click", exportPDF);
  btnScreenshot?.addEventListener("click", takeScreenshot);

  // Init
  window.addEventListener("DOMContentLoaded", async () => {
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    initTabs();
    initKey();
    await ping();
  });
})();
