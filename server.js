import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4000;

const PUBLIC_DIR  = path.join(__dirname, 'public');
const SHOTS_DIR   = path.join(__dirname, 'screenshots');
const REPORTS_DIR = path.join(__dirname, 'reports');

for (const dir of [PUBLIC_DIR, SHOTS_DIR, REPORTS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/screenshots', express.static(SHOTS_DIR));
app.use('/reports', express.static(REPORTS_DIR));

const launchBrowser = () =>
  puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
    // executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });

/* ---------------- SCRAPE (basic info, no cheerio) ---------------- */
app.post('/api/scrape', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ success: false, error: 'Provide a valid http(s) URL.' });
    }

    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const data = await page.evaluate(() => {
      const pick = (sel, attr) => {
        const el = document.querySelector(sel);
        if (!el) return '';
        return attr ? el.getAttribute(attr) || '' : (el.textContent || '').trim();
      };
      return {
        title: document.title || '',
        metaDescription: pick('meta[name="description"]', 'content'),
        canonical: pick('link[rel="canonical"]', 'href'),
        robots: pick('meta[name="robots"]', 'content'),
        h1: Array.from(document.querySelectorAll('h1')).map(el => (el.textContent || '').trim()).filter(Boolean),
        links: Array.from(document.querySelectorAll('a[href]')).slice(0, 20).map(el => ({
          text: (el.textContent || '').trim(),
          href: el.href
        }))
      };
    });

    await browser.close();
    return res.json({ success: true, url, scraped: data });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Scrape failed', details: String(e?.message || e) });
  }
});

/* ---------------- SCREENSHOT ---------------- */
app.post('/api/screenshot', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ success: false, error: 'Provide a valid http(s) URL.' });
    }

    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(SHOTS_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: true });

    await browser.close();
    return res.json({ success: true, imageUrl: `/screenshots/${filename}` });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Screenshot failed', details: String(e?.message || e) });
  }
});

/* ---------------- FULL AUDIT (SECURITY-ONLY) ---------------- */
app.post('/api/audit', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ success: false, error: 'Provide a valid http(s) URL.' });
    }

    const browser = await launchBrowser();
    const page = await browser.newPage();

    const isHTTPS = url.startsWith('https://');

    // Mixed content (HTTP requests on HTTPS page)
    const mixedContent = [];
    page.on('request', (r) => {
      const ru = r.url();
      if (isHTTPS && ru.startsWith('http://')) mixedContent.push(ru);
    });

    // JS errors
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(String(err)));
    page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(`console.error: ${msg.text()}`); });

    // Navigate
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    const status = response?.status() ?? null;

    // Security headers
    const h = response?.headers() || {};
    const headers = {
      strictTransportSecurity: h['strict-transport-security'] || null,
      contentSecurityPolicy:   h['content-security-policy'] || null,
      xContentTypeOptions:     h['x-content-type-options'] || null,
      xFrameOptions:           h['x-frame-options'] || null,
      referrerPolicy:          h['referrer-policy'] || null,
      permissionsPolicy:       h['permissions-policy'] || null
    };

    // Cookies
    const cookies = (await page.cookies()).map(c => ({
      name: c.name,
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      sameSite: c.sameSite || null
    }));

    // Lightweight probes for SQLi / XSS indicators (safe)
    const probes = { possibleSQLiIndicators: [], possibleXSSIndicators: [] };
    try {
      // SQLi probe
      const tests = ["'", "\"", "1 OR 1=1", "' OR '1'='1", "');--"];
      const dbErr = [
        /sql syntax/i, /mysql/i, /postgres/i, /sqlite/i, /mssql/i, /odbc/i, /ora-\d+/i,
        /unterminated/i, /warning:.*mysqli/i
      ];
      for (const p of tests) {
        const u = new URL(url); u.searchParams.set('probe', p);
        await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const lower = (await page.content()).toLowerCase();
        if (dbErr.some(rx => rx.test(lower))) {
          probes.possibleSQLiIndicators.push({ payload: p, url: u.href });
          break;
        }
      }
      // XSS probe (reflected harmless marker)
      const marker = 'xss_probe_<img>';
      const u2 = new URL(url); u2.searchParams.set('q', marker);
      await page.goto(u2.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const reflected = await page.evaluate(m => document.documentElement.innerHTML.includes(m), marker);
      if (reflected) probes.possibleXSSIndicators.push({ param: 'q', value: marker, url: u2.href });

      // Back to original page
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    } catch { /* ignore probe failures */ }

    // Screenshot for report
    const base = url.replace(/[^a-z0-9]/gi, '_').slice(0, 60) + '_' + Date.now();
    const shotFile = `${base}.png`;
    const shotPath = path.join(SHOTS_DIR, shotFile);
    await page.screenshot({ path: shotPath, fullPage: true });

    await browser.close();

    // Security recommendations
    const recs = [];
    if (!isHTTPS) recs.push('Serve the site over HTTPS to protect data in transit.');
    if (!headers.strictTransportSecurity) recs.push('Add HSTS (Strict-Transport-Security) to enforce HTTPS.');
    if (!headers.contentSecurityPolicy) recs.push('Define a strict Content-Security-Policy to mitigate XSS and injections.');
    if (!headers.xContentTypeOptions) recs.push('Set X-Content-Type-Options: nosniff to prevent MIME sniffing.');
    if (!headers.xFrameOptions) recs.push('Set X-Frame-Options or CSP frame-ancestors to prevent clickjacking.');
    if (!headers.referrerPolicy) recs.push('Set a Referrer-Policy to limit referrer leakage.');
    if (mixedContent.length) recs.push('Remove/upgrade mixed-content HTTP resources on HTTPS pages.');
    cookies.forEach(c => {
      if (!c.httpOnly) recs.push(`Set HttpOnly on cookie "${c.name}" to block JS access.`);
      if (isHTTPS && !c.secure) recs.push(`Set Secure on cookie "${c.name}" so it is only sent over HTTPS.`);
      if (!c.sameSite) recs.push(`Set SameSite (Lax/Strict) on cookie "${c.name}" to mitigate CSRF.`);
    });
    if (probes.possibleSQLiIndicators.length) recs.push('Potential SQL injection indicators — parameterize queries and validate inputs.');
    if (probes.possibleXSSIndicators.length) recs.push('Reflected content indicator — sanitize/escape input and enforce a strict CSP.');
    if (jsErrors.length) recs.push('Fix JavaScript runtime/console errors that may expose vulnerabilities.');

    // Minimal HTML report (security-only)
    const html = `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Security Report - ${url}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;line-height:1.45}
h1{margin:0 0 8px;font-size:22px} h2{margin:16px 0 8px;font-size:18px}
table{border-collapse:collapse;width:100%} th,td{border:1px solid #eee;padding:6px;text-align:left}
.kv{display:grid;grid-template-columns:220px 1fr;gap:8px;margin:8px 0}
.bad{color:#b00020}
img{max-width:100%;border:1px solid #eee;border-radius:8px}
</style>
</head><body>
<h1>Security Report</h1>
<div class="kv">
  <div>URL</div><div><a href="${url}">${url}</a></div>
  <div>Status</div><div>${status}</div>
  <div>HTTPS</div><div>${isHTTPS ? 'Yes' : '<span class="bad">No</span>'}</div>
</div>
<h2>Screenshot</h2><img src="../screenshots/${shotFile}" alt="screenshot">
<h2>Security Headers</h2>
<table><tbody>
<tr><th>HSTS</th><td>${headers.strictTransportSecurity || '<span class="bad">Missing</span>'}</td></tr>
<tr><th>CSP</th><td>${headers.contentSecurityPolicy || '<span class="bad">Missing</span>'}</td></tr>
<tr><th>X-Content-Type-Options</th><td>${headers.xContentTypeOptions || '<span class="bad">Missing</span>'}</td></tr>
<tr><th>X-Frame-Options</th><td>${headers.xFrameOptions || '<span class="bad">Missing</span>'}</td></tr>
<tr><th>Referrer-Policy</th><td>${headers.referrerPolicy || '<span class="bad">Missing</span>'}</td></tr>
<tr><th>Permissions-Policy</th><td>${headers.permissionsPolicy || '—'}</td></tr>
</tbody></table>
<h2>Cookies</h2>
<table><thead><tr><th>Name</th><th>HttpOnly</th><th>Secure</th><th>SameSite</th></tr></thead>
<tbody>${cookies.map(c=>`<tr><td>${c.name}</td><td>${c.httpOnly}</td><td>${c.secure}</td><td>${c.sameSite||'—'}</td></tr>`).join('')}</tbody></table>
<h2>Mixed Content</h2>
${mixedContent.length ? '<ul>' + mixedContent.slice(0,25).map(u=>`<li>${u}</li>`).join('') + '</ul>' : 'None'}
<h2>JavaScript Errors</h2>
${jsErrors.length ? '<ul>' + jsErrors.slice(0,25).map(e=>`<li><code>${e.replace(/[<>&]/g,s=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</code></li>`).join('') + '</ul>' : 'None'}
<h2>Indicators</h2>
<p><b>SQLi:</b> ${probes.possibleSQLiIndicators.length ? 'Possible' : 'None'}</p>
<p><b>XSS:</b> ${probes.possibleXSSIndicators.length ? 'Possible' : 'None'}</p>
<h2>Recommendations</h2>
${recs.length ? '<ul>' + Array.from(new Set(recs)).map(r=>`<li>${r}</li>`).join('') + '</ul>' : 'No major issues detected.'}
</body></html>`;

    const reportFile = `${base}.html`;
    fs.writeFileSync(path.join(REPORTS_DIR, reportFile), html, 'utf8');

    const report = {
      security: {
        status,
        isHTTPS,
        headers,
        cookies,
        mixedContent: mixedContent.slice(0, 25),
        javascriptErrors: jsErrors.slice(0, 25),
        probes,
        recommendations: Array.from(new Set(recs))
      }
    };

    return res.json({
      success: true,
      report,
      reportId: base,
      reportUrl: `/reports/${reportFile}`,
      screenshotUrl: `/screenshots/${shotFile}`
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Audit (security) failed', details: String(e?.message || e) });
  }
});

/* ---------------- EXPORTS (JSON / CSV / PDF) — FIXED ---------------- */
app.post('/api/export', async (req, res) => {
  try {
    const { format, report, reportId, reportUrl } = req.body || {};
    if (!format) {
      return res.status(400).json({ success: false, error: 'Missing "format". Use json | csv | pdf.' });
    }

    const base = reportId || `report_${Date.now()}`;

    if (format === 'json') {
      if (!report) return res.status(400).json({ success: false, error: 'Provide "report" JSON to export.' });
      const file = path.join(REPORTS_DIR, `${base}.json`);
      fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
      return res.json({ success: true, fileUrl: `/reports/${path.basename(file)}` });
    }

    if (format === 'csv') {
      if (!report) return res.status(400).json({ success: false, error: 'Provide "report" JSON to export.' });
      // Flatten a simple CSV from the security report
      const s = report.security || {};
      const rows = [
        ['URL', report.url || ''],
        ['HTTPS', String(s.isHTTPS)],
        ['Status', s.status ?? ''],
        ['HSTS', s.headers?.strictTransportSecurity ? 'Present' : 'Missing'],
        ['CSP', s.headers?.contentSecurityPolicy ? 'Present' : 'Missing'],
        ['X-Content-Type-Options', s.headers?.xContentTypeOptions || 'Missing'],
        ['X-Frame-Options', s.headers?.xFrameOptions || 'Missing'],
        ['Referrer-Policy', s.headers?.referrerPolicy || 'Missing'],
        ['Permissions-Policy', s.headers?.permissionsPolicy || '—'],
        ['Cookies', (s.cookies || []).length],
        ['MixedContentCount', (s.mixedContent || []).length],
        ['JSErrorsCount', (s.javascriptErrors || []).length],
        ['SQLiIndicators', (s.probes?.possibleSQLiIndicators || []).length],
        ['XSSIndicators', (s.probes?.possibleXSSIndicators || []).length]
      ];
      const csv = ['key,value', ...rows.map(([k,v]) => `${JSON.stringify(k)},${JSON.stringify(v)}`)].join('\n');
      const file = path.join(REPORTS_DIR, `${base}.csv`);
      fs.writeFileSync(file, csv, 'utf8');
      return res.json({ success: true, fileUrl: `/reports/${path.basename(file)}` });
    }

    if (format === 'pdf') {
      if (!reportUrl) return res.status(400).json({ success: false, error: 'Provide "reportUrl" (HTML report) for PDF export.' });
      const browser = await launchBrowser();
      const page = await browser.newPage();
      const absoluteUrl = `http://localhost:${PORT}${reportUrl}`;
      await page.goto(absoluteUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      const file = path.join(REPORTS_DIR, `${base}.pdf`);
      await page.pdf({ path: file, printBackground: true, format: 'A4' });
      await browser.close();
      return res.json({ success: true, fileUrl: `/reports/${path.basename(file)}` });
    }

    return res.status(400).json({ success: false, error: 'Unsupported format. Use json | csv | pdf.' });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Export failed', details: String(e?.message || e) });
  }
});

/* ---------------- START SERVER ---------------- */
app.listen(PORT, () => {
  console.log(`Server is running → http://localhost:${PORT}`);
});
