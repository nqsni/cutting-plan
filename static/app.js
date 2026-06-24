/* ============================================================
   CUTTING PLAN OPTIMIZER — app.js
   ============================================================ */

// ── State ──
let parsedGroups = [];
let calcResults  = null;
let drawnCanvases = new Set();   // track canvas id yang sudah digambar

// ── DOM refs ──
const uploadZone    = document.getElementById('upload-zone');
const fileInput     = document.getElementById('file-input');
const browseBtn     = document.getElementById('browse-btn');
const uploadStatus  = document.getElementById('upload-status');
const sectionGroups = document.getElementById('section-groups');
const sectionCalc   = document.getElementById('section-calc');
const groupsConfig  = document.getElementById('groups-config');
const parseSummary  = document.getElementById('parse-summary');
const btnCalc       = document.getElementById('btn-calc');
const btnReset      = document.getElementById('btn-reset');
const resultsEmpty  = document.getElementById('results-empty');
const resultsContent = document.getElementById('results-content');
const loadingOverlay = document.getElementById('loading-overlay');
const summaryCards  = document.getElementById('summary-cards');
const tabsBar       = document.getElementById('tabs-bar');
const tabContent    = document.getElementById('tab-content');

// ── Warna segmen ──
const SEG_COLORS = [
  '#3B52D6','#7C3AED','#059669','#D97706','#DC2626',
  '#0891B2','#9333EA','#16A34A','#EA580C','#DB2777',
];
const segColor = i => SEG_COLORS[i % SEG_COLORS.length];

// ══════════════════════════════════════════════════════════
//  UPLOAD
// ══════════════════════════════════════════════════════════
browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
btnReset.addEventListener('click', resetAll);

function handleFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showStatus('error', 'Format file tidak didukung. Gunakan .xlsx atau .xls');
    return;
  }
  showStatus('info', `Membaca ${file.name}…`);

  const fd = new FormData();
  fd.append('file', file);

  fetch('/api/parse-excel', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (data.error) { showStatus('error', data.error); return; }
      parsedGroups = data.groups;
      showStatus('success',
        `✓ ${file.name} — ${data.total_items} item, ${data.total_groups} grup terdeteksi`);
      renderGroupsConfig(data.groups);
      sectionGroups.hidden = false;
      sectionCalc.hidden   = false;
    })
    .catch(err => {
      showStatus('error', 'Gagal terhubung ke server. Pastikan Flask berjalan.');
      console.error(err);
    });
}

function showStatus(type, msg) {
  uploadStatus.hidden = false;
  uploadStatus.className = 'upload-status ' + (type === 'info' ? '' : type);
  uploadStatus.textContent = msg;
}

// ══════════════════════════════════════════════════════════
//  KONFIGURASI GRUP
//  Pakai index numerik (idx) sebagai ID elemen DOM
//  — menghindari masalah titik/karakter khusus di spec_key
// ══════════════════════════════════════════════════════════
function renderGroupsConfig(groups) {
  const nCut = groups.filter(g => g.bisa_cut).length;
  const nPcs = groups.filter(g => !g.bisa_cut).length;
  parseSummary.innerHTML =
    `<strong>${groups.length}</strong> grup: ` +
    `<strong>${nCut}</strong> cutting plan, ` +
    `<strong>${nPcs}</strong> hanya PCS`;

  let html = '';
  groups.forEach((g, idx) => {
    const badgeCls  = g.kategori === 'PLAT'   ? 'badge-plat'
                    : g.kategori === 'PROFIL'  ? 'badge-profil' : 'badge-pcs';
    const badgeTxt  = g.kategori === 'PLAT'   ? 'PLAT 2D'
                    : g.kategori === 'PROFIL'  ? 'PROFIL 1D'    : 'PCS';

    // Tampilkan varian lebar untuk PLAT (info saja)
    let extraInfo = '';
    if (g.kategori === 'PLAT' && g.dimensi?.lebar_variants?.length) {
      extraInfo = `<span style="font-size:10px;color:var(--c-text-3);font-weight:400;display:block;margin-top:2px">
        Lebar: ${g.dimensi.lebar_variants.map(v => v + ' mm').join(' · ')}</span>`;
    }

    html += `
      <div class="group-card" data-idx="${idx}">
        <div class="group-card-header">
          <span class="group-badge ${badgeCls}">${badgeTxt}</span>
          <span class="group-spec" title="${esc(g.spec_raw)}">
            ${esc(g.label || g.spec_raw)}
            ${extraInfo}
          </span>
          <span class="group-qty">${g.total_qty} pcs</span>
        </div>
        <div class="group-card-body">
          ${!g.bisa_cut
            ? `<span class="pcs-note">Tidak ada cutting plan — dihitung total qty</span>`
            : g.kategori === 'PLAT'
              ? renderPlat2DInput(idx)
              : render1DInput(idx)
          }
        </div>
      </div>`;
  });

  groupsConfig.innerHTML = html;
  groupsConfig.querySelectorAll('.raw-select').forEach(sel => {
    sel.addEventListener('change', onSelectChange);
  });
}

function renderPlat2DInput(idx) {
  return `
    <div class="raw-input-row">
      <label>Ukuran lembaran:</label>
      <select class="raw-select" data-idx="${idx}" data-mode="2d">
        <option value="1200x2400">1200 × 2400 (default)</option>
        <option value="1500x6000">1500 × 6000</option>
        <option value="1800x6000">1800 × 6000</option>
        <option value="custom">Custom…</option>
      </select>
    </div>
    <div class="custom-inputs" id="custom-2d-${idx}" style="display:none">
      <label>P: <input class="raw-input-num" type="number" id="cw-${idx}" value="1200" min="1"></label>
      <label>L: <input class="raw-input-num" type="number" id="ch-${idx}" value="2400" min="1"></label>
      <small style="font-size:10px;color:var(--c-text-3);align-self:center">mm</small>
    </div>`;
}

function render1DInput(idx) {
  return `
    <div class="raw-input-row">
      <label>Panjang batang:</label>
      <select class="raw-select" data-idx="${idx}" data-mode="1d">
        <option value="12000">12.000 mm (default)</option>
        <option value="6000">6.000 mm</option>
        <option value="custom">Custom…</option>
      </select>
    </div>
    <div class="custom-inputs" id="custom-1d-${idx}" style="display:none">
      <label>Panjang: <input class="raw-input-num" type="number" id="cl-${idx}" value="12000" min="1"></label>
      <small style="font-size:10px;color:var(--c-text-3);align-self:center">mm</small>
    </div>`;
}

function onSelectChange(e) {
  const { idx, mode } = e.target.dataset;
  const div = document.getElementById(`custom-${mode}-${idx}`);
  if (div) div.style.display = e.target.value === 'custom' ? 'flex' : 'none';
}

function collectRawConfigs() {
  const configs = {};
  parsedGroups.forEach((g, idx) => {
    if (!g.bisa_cut) return;
    const sel = groupsConfig.querySelector(`.raw-select[data-idx="${idx}"]`);
    if (!sel) return;
    const key = g.spec_key;

    if (g.kategori === 'PLAT') {
      let rw = 1200, rh = 2400;
      if (sel.value === 'custom') {
        rw = parseFloat(document.getElementById(`cw-${idx}`)?.value) || 1200;
        rh = parseFloat(document.getElementById(`ch-${idx}`)?.value) || 2400;
      } else {
        [rw, rh] = sel.value.split('x').map(Number);
      }
      configs[key] = { raw_w: rw, raw_h: rh };
    } else {
      let rl = 12000;
      if (sel.value === 'custom') {
        rl = parseFloat(document.getElementById(`cl-${idx}`)?.value) || 12000;
      } else {
        rl = parseFloat(sel.value) || 12000;
      }
      configs[key] = { raw_length: rl };
    }
  });
  return configs;
}

// ══════════════════════════════════════════════════════════
//  HITUNG
// ══════════════════════════════════════════════════════════
btnCalc.addEventListener('click', () => {
  if (!parsedGroups.length) return;
  const configs = collectRawConfigs();
  btnCalc.disabled = true;
  loadingOverlay.hidden = false;
  resultsContent.hidden = true;
  resultsEmpty.hidden   = true;

  fetch('/api/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_configs: configs }),
  })
    .then(r => r.json())
    .then(data => {
      console.log('RESPONSE /api/calculate:', data);
      loadingOverlay.hidden = true;
      btnCalc.disabled = false;
      if (data.error) {
        alert('Error: ' + data.error);
        resultsEmpty.hidden = false;
        return;
      }
      calcResults = data;
      renderResults(data);
    })
    .catch(err => {
      loadingOverlay.hidden = true;
      btnCalc.disabled = false;
      resultsEmpty.hidden = false;
      alert('Gagal terhubung ke server: ' + err.message);
      console.error(err);
    });
});

// ══════════════════════════════════════════════════════════
//  RENDER HASIL
// ══════════════════════════════════════════════════════════
function renderResults(data) {
  resultsContent.hidden = false;
  drawnCanvases.clear();

  const s = data.summary;
  summaryCards.innerHTML = `
    <div class="summary-card accent">
      <div class="card-value">${s.cuttable_groups}</div>
      <div class="card-label">Grup Cutting</div>
    </div>
    <div class="summary-card">
      <div class="card-value">${s.total_raw_material}</div>
      <div class="card-label">Total Raw Material</div>
    </div>
    <div class="summary-card ${effClass(s.avg_efficiency)}">
      <div class="card-value">${s.avg_efficiency}%</div>
      <div class="card-label">Rata-rata Efisiensi</div>
    </div>
    <div class="summary-card">
      <div class="card-value">${s.pcs_groups}</div>
      <div class="card-label">Grup PCS</div>
    </div>`;

  const results = data.results;
  let tabsHTML = '', contentHTML = '';

  results.forEach((r, i) => {
    const isPCS = r.mode === 'PCS';
    const label = r.label || r.spec_raw;
    const short = label.length > 20 ? label.slice(0, 18) + '…' : label;

    tabsHTML += `<button class="tab-btn ${i === 0 ? 'active' : ''} ${isPCS ? 'pcs' : ''}"
      data-tab="${i}" onclick="switchTab(${i})">${esc(short)}</button>`;

    contentHTML += `<div class="tab-pane ${i === 0 ? 'active' : ''}" id="tab-pane-${i}">`;
    if      (isPCS)         contentHTML += renderPCSResult(r);
    else if (r.mode === '2D') contentHTML += render2DResult(r, i);
    else                    contentHTML += render1DResult(r);
    contentHTML += `</div>`;
  });

  // Tab rekap
  tabsHTML += `<button class="tab-btn" data-tab="rekap" onclick="switchTab('rekap')">📋 Rekap Semua</button>`;
  contentHTML += `<div class="tab-pane" id="tab-pane-rekap">${renderRekap(results)}</div>`;

  tabsBar.innerHTML    = tabsHTML;
  tabContent.innerHTML = contentHTML;

  // Gambar canvas tab pertama yang aktif setelah DOM siap
  requestAnimationFrame(() => drawVisibleCanvases(results));
}

// ── Tab switching ──
window.switchTab = function(id) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab == id));
  document.querySelectorAll('.tab-pane').forEach(p =>
    p.classList.toggle('active', p.id === `tab-pane-${id}`));

  // Gambar canvas yang belum digambar di tab ini
  if (calcResults) {
    requestAnimationFrame(() => drawVisibleCanvases(calcResults.results));
  }
};

// Gambar semua canvas yang saat ini visible dan belum pernah digambar
function drawVisibleCanvases(results) {
  results.forEach((r, i) => {
    if (r.mode !== '2D') return;
    r.sheets.forEach((sheet, si) => {
      const canvasId = `cvs-${i}-${si}`;
      if (drawnCanvases.has(canvasId)) return;
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      // Hanya gambar jika elemen visible (offsetParent bukan null berarti visible)
      if (!canvas.offsetParent && canvas.offsetWidth === 0) return;
      drawPlateCanvas(canvas, r, sheet);
      drawnCanvases.add(canvasId);
    });
  });
}

// ── Render PCS ──
function renderPCSResult(r) {
  return `
    <div class="group-result-card">
      <div class="group-result-header">
        <div>
          <div class="group-result-title">${esc(r.label || r.spec_raw)}</div>
          <div class="group-result-meta">
            <span class="meta-item"><strong>${r.total_qty}</strong> pcs total</span>
            <span class="meta-item">Kategori: ${esc(r.kategori)}</span>
          </div>
        </div>
        <span class="group-badge badge-pcs">PCS ONLY</span>
      </div>
      ${renderItemsTable(r.items)}
    </div>`;
}

// ── Render 1D ──
function render1DResult(r) {
  const effCls = effClass(r.efficiency);
  let barsHTML = '<div class="bars-list">';

  r.bars.forEach((bar, bi) => {
    barsHTML += `
      <div class="bar-row">
        <div class="bar-label">Batang ${bi + 1} — sisa ${fmt1(bar.remaining)} mm</div>
        <div class="bar-track">`;

    bar.pieces.forEach((p, pi) => {
      const pct   = (p.length / r.raw_length) * 100;
      const color = segColor(pi);
      // Cari partname dari r.items
      const itData = r.items.find(it => it.drawing_no === p.drawing_no);
      const pname  = itData ? (itData.partname || '') : '';
      barsHTML += `<div class="bar-segment"
        style="width:${pct.toFixed(2)}%;background:${color};cursor:default"
        onmouseenter="showBarTip(event,'${esc(p.drawing_no)}','${esc(pname)}','${fmt1(p.length)}')"
        onmouseleave="hideBarTip()">
        ${pct > 5 ? esc(p.drawing_no) : ''}
      </div>`;
    });

    const remPct = (bar.remaining / r.raw_length) * 100;
    if (remPct > 0.1) {
      barsHTML += `<div class="bar-remaining" style="width:${remPct.toFixed(2)}%"></div>`;
    }
    barsHTML += `</div></div>`;
  });
  barsHTML += '</div>';

  return `
    <div class="group-result-card">
      <div class="group-result-header">
        <div>
          <div class="group-result-title">${esc(r.label || r.spec_raw)}</div>
          <div class="group-result-meta">
            <span class="meta-item"><strong>${r.num_bars}</strong> batang</span>
            <span class="meta-item">Raw: <strong>${fmt1(r.raw_length)} mm</strong></span>
            <span class="meta-item"><strong>${r.pieces_count}</strong> potongan</span>
          </div>
        </div>
        <div>
          <div class="efficiency-badge ${effCls}">${r.efficiency}%</div>
          <div class="eff-label">efisiensi</div>
        </div>
      </div>
      <div class="viz-section">
        <div class="viz-title">Visualisasi pemotongan</div>
        <div class="viz-scroll">${barsHTML}</div>
      </div>
      ${renderItemsTable(r.items)}
    </div>`;
}

// ── Render 2D ──
// Gunakan index hasil (ri) sebagai bagian ID canvas — unik & bebas karakter khusus
function render2DResult(r, ri) {
  const effCls = effClass(r.efficiency);

  // Info lebar-lebar potongan yang ada di grup ini
  const lebarList = [...new Set(r.items.filter(i => i.lebar).map(i => i.lebar))]
    .sort((a, b) => a - b);
  const lebarInfo = lebarList.length
    ? `<div style="font-size:11px;color:var(--c-text-3);margin-top:2px">
         Lebar potongan: ${lebarList.map(v => fmt1(v) + ' mm').join(' · ')}
       </div>`
    : '';

  let sheetsHTML = '<div style="display:flex;flex-wrap:wrap;gap:12px;">';
  r.sheets.forEach((sheet, si) => {
    sheetsHTML += `
      <div>
        <div style="font-size:11px;color:var(--c-text-3);margin-bottom:4px">
          Plat ${si + 1} — efisiensi ${sheet.efficiency || 0}%
        </div>
        <div class="canvas-wrap" style="position:relative;display:inline-block">
          <canvas id="cvs-${ri}-${si}" class="plate-canvas"
            data-ri="${ri}" data-si="${si}"></canvas>
          <div id="tip-${ri}-${si}" class="canvas-tooltip" hidden></div>
        </div>
      </div>`;
  });
  sheetsHTML += '</div>';

  return `
    <div class="group-result-card">
      <div class="group-result-header">
        <div>
          <div class="group-result-title">${esc(r.label || r.spec_raw)}</div>
          ${lebarInfo}
          <div class="group-result-meta">
            <span class="meta-item"><strong>${r.num_sheets}</strong> lembar</span>
            <span class="meta-item">Raw: <strong>${fmt1(r.raw_w)} × ${fmt1(r.raw_h)} mm</strong></span>
            <span class="meta-item"><strong>${r.pieces_count}</strong> potongan</span>
          </div>
        </div>
        <div>
          <div class="efficiency-badge ${effCls}">${r.efficiency}%</div>
          <div class="eff-label">efisiensi</div>
        </div>
      </div>
      <div class="viz-section">
        <div class="viz-title">Visualisasi pemotongan</div>
        <div class="viz-scroll">${sheetsHTML}</div>
      </div>
      ${renderItemsTable(r.items)}
    </div>`;
}

// ── Draw satu lembar plat ke canvas ──
function drawPlateCanvas(canvas, r, sheet) {
  const MAX_W = 300, MAX_H = 380;
  const scale  = Math.min(MAX_W / r.raw_w, MAX_H / r.raw_h);
  const cw     = Math.round(r.raw_w * scale);
  const ch     = Math.round(r.raw_h * scale);

  canvas.width  = cw;
  canvas.height = ch;
  canvas.style.width  = cw + 'px';
  canvas.style.height = ch + 'px';

  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#F8F9FA';
  ctx.fillRect(0, 0, cw, ch);

  // Grid ringan
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 0.5;
  const gridStep = Math.max(20, Math.round(100 * scale));
  for (let x = 0; x < cw; x += gridStep) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
  }
  for (let y = 0; y < ch; y += gridStep) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
  }

  // Potongan
  sheet.pieces.forEach((p, pi) => {
    const x = p.x * scale;
    const y = p.y * scale;
    const w = p.w * scale;
    const h = p.h * scale;
    const color = segColor(pi);

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.82;
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    // Label: drawing_no + dimensi
    if (w > 22 && h > 14) {
      ctx.fillStyle = 'white';
      const fontSize = Math.max(7, Math.min(10, w / 5, h / 3));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const drawingLabel = p.drawing_no || '';
      const dimLabel     = `${fmt1(p.w)}×${fmt1(p.h)}`;

      if (h > fontSize * 2.5) {
        ctx.fillText(drawingLabel, x + w / 2, y + h / 2 - fontSize * 0.6);
        ctx.font = `${Math.max(6, fontSize - 1)}px sans-serif`;
        ctx.globalAlpha = 0.8;
        ctx.fillText(dimLabel, x + w / 2, y + h / 2 + fontSize * 0.7);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillText(drawingLabel, x + w / 2, y + h / 2);
      }
    }
  });

  // Border luar plat
  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.5, 0.5, cw - 1, ch - 1);

  // Tooltip: simpan pieces + scale di canvas untuk mousemove
  canvas._pieces = sheet.pieces;
  canvas._scale  = scale;
  canvas._partnames = {};
  if (r && r.items) {
    r.items.forEach(it => { canvas._partnames[it.drawing_no] = it.partname || ''; });
  }

  canvas.onmousemove = function(e) {
    const rect  = canvas.getBoundingClientRect();
    const mx    = (e.clientX - rect.left) / canvas._scale;
    const my    = (e.clientY - rect.top)  / canvas._scale;
    const tip   = canvas.parentElement.querySelector('.canvas-tooltip');
    if (!tip) return;
    let hit = null;
    for (const p of canvas._pieces) {
      if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) {
        hit = p; break;
      }
    }
    if (hit) {
      const pname = canvas._partnames[hit.drawing_no] || '';
      tip.innerHTML =
        `<strong>${hit.drawing_no}</strong>${pname ? '<br>' + pname : ''}<br>` +
        `${fmt1(hit.w)} × ${fmt1(hit.h)} mm` +
        (hit.rotated ? ' <span style="opacity:.7">(rotasi)</span>' : '');
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      tip.style.left = (cx + 10) + 'px';
      tip.style.top  = (cy - 10) + 'px';
      tip.hidden = false;
    } else {
      tip.hidden = true;
    }
  };
  canvas.onmouseleave = function() {
    const tip = canvas.parentElement.querySelector('.canvas-tooltip');
    if (tip) tip.hidden = true;
  };
}

// ── Items table ──
function renderItemsTable(items) {
  if (!items?.length) return '';
  const hasLebar = items.some(it => it.lebar != null);

  let html = `
    <div class="items-table-wrap">
      <table class="items-table">
        <thead>
          <tr>
            <th>Drawing No</th>
            <th>Part Name</th>
            ${hasLebar ? '<th>Dimensi Potongan</th>' : ''}
            <th>Panjang (mm)</th>
            <th>Mtl</th>
            <th>QTY</th>
          </tr>
        </thead>
        <tbody>`;

  for (const it of items) {
    const dimCell = hasLebar
      ? `<td style="font-size:11px;color:var(--c-text-2)">
           ${it.lebar ? `${fmt1(it.lebar)} × ${it.panjang ? fmt1(it.panjang) : '?'} mm` : '—'}
         </td>`
      : '';
    html += `
      <tr>
        <td class="drawing-no-cell">${esc(it.drawing_no)}</td>
        <td>${esc(it.partname || '—')}</td>
        ${dimCell}
        <td>${it.panjang ? fmt1(it.panjang) : '—'}</td>
        <td>${esc(it.mtl || '—')}</td>
        <td><strong>${it.qty}</strong></td>
      </tr>`;
  }

  html += `</tbody></table></div>`;
  return html;
}

// ── Rekap ──
function renderRekap(results) {
  let html = `
    <div class="rekap-section">
      <div class="rekap-title">Rekapitulasi Semua Material</div>
      <div class="items-table-wrap">
        <table class="items-table">
          <thead>
            <tr>
              <th>Spesifikasi</th>
              <th>Kategori</th>
              <th>Total QTY</th>
              <th>Raw Material</th>
              <th>Efisiensi</th>
            </tr>
          </thead>
          <tbody>`;

  for (const r of results) {
    const rawInfo = r.mode === '2D'
      ? `${r.num_sheets} lembar (${fmt1(r.raw_w)} × ${fmt1(r.raw_h)} mm)`
      : r.mode === '1D'
      ? `${r.num_bars} batang (${fmt1(r.raw_length)} mm)`
      : '—';

    const eff = r.efficiency != null
      ? `<span class="${effClass(r.efficiency)}">${r.efficiency}%</span>` : '—';

    const badge = r.kategori === 'PLAT'   ? 'badge-plat'
                : r.kategori === 'PROFIL' ? 'badge-profil' : 'badge-pcs';

    html += `
      <tr>
        <td><strong>${esc(r.label || r.spec_raw)}</strong></td>
        <td><span class="group-badge ${badge}">${esc(r.kategori)}</span></td>
        <td><strong>${r.total_qty}</strong></td>
        <td>${rawInfo}</td>
        <td>${eff}</td>
      </tr>`;
  }

  html += `</tbody></table></div></div>`;
  return html;
}

// ── Bar tooltip (1D) ──
let _barTip = null;
function showBarTip(e, drawingNo, partname, length) {
  if (!_barTip) {
    _barTip = document.createElement('div');
    _barTip.className = 'canvas-tooltip';
    document.body.appendChild(_barTip);
    _barTip.style.position = 'fixed';
  }
  _barTip.innerHTML =
    `<strong>${drawingNo}</strong>${partname ? '<br>' + partname : ''}<br>${length} mm`;
  _barTip.style.left = (e.clientX + 12) + 'px';
  _barTip.style.top  = (e.clientY - 10) + 'px';
  _barTip.hidden = false;
}
function hideBarTip() {
  if (_barTip) _barTip.hidden = true;
}

// ── Reset ──
function resetAll() {
  parsedGroups = [];
  calcResults  = null;
  drawnCanvases.clear();
  fileInput.value      = '';
  uploadStatus.hidden  = true;
  sectionGroups.hidden = true;
  sectionCalc.hidden   = true;
  groupsConfig.innerHTML  = '';
  resultsContent.hidden   = true;
  resultsEmpty.hidden     = false;
  tabsBar.innerHTML    = '';
  tabContent.innerHTML = '';
}

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt1(n) {
  if (n == null) return '—';
  const v = parseFloat(n);
  if (isNaN(v)) return '—';
  return v % 1 === 0 ? v.toLocaleString('id-ID') : v.toFixed(1);
}

function effClass(pct) {
  if (pct >= 80) return 'eff-good green';
  if (pct >= 60) return 'eff-ok amber';
  return 'eff-bad';
}