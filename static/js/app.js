// static/js/app.js

const PALETTE = [
  {f:'#dce9f7',s:'#3D74B6',t:'#2d5a8e'},
  {f:'#efe8d8',s:'#a07840',t:'#6b4e1e'},
  {f:'#fdf0ed',s:'#DC3C22',t:'#a82c18'},
  {f:'#d8ead8',s:'#2e7d4f',t:'#1a5233'},
  {f:'#f5eacc',s:'#c08010',t:'#7a5000'},
  {f:'#e8d8f0',s:'#7048a8',t:'#4a2878'},
  {f:'#d8e8f0',s:'#2878a8',t:'#185878'},
  {f:'#f0d8d8',s:'#a83838',t:'#782020'},
  {f:'#dcecd8',s:'#508830',t:'#306010'},
  {f:'#e8e4d8',s:'#6a6450',t:'#484030'},
];

const SAMPLE_BQ = [
  {mark:'P-01', sub_mark:'Base Plate A',  lebar:800,  panjang:1200, qty:3},
  {mark:'P-02', sub_mark:'Base Plate B',  lebar:600,  panjang:900,  qty:4},
  {mark:'P-03', sub_mark:'Gusset Plate',  lebar:400,  panjang:400,  qty:8},
  {mark:'P-04', sub_mark:'Cover Plate',   lebar:1200, panjang:500,  qty:2},
  {mark:'P-05', sub_mark:'Stiffener',     lebar:200,  panjang:800,  qty:6},
  {mark:'P-06', sub_mark:'End Plate',     lebar:350,  panjang:600,  qty:4},
];

let rows = [], cmap = {}, ci = 0;

function gc(code) {
  if (!cmap[code]) { cmap[code] = PALETTE[ci % PALETTE.length]; ci++; }
  return cmap[code];
}
function rc() { cmap = {}; ci = 0; }

function switchTab(t) {
  ['input','result'].forEach(id => {
    document.getElementById('tab-'+id).classList.toggle('active', id===t);
    document.getElementById('pane-'+id).classList.toggle('hidden', id!==t);
  });
}

function addRow(d={}) {
  const id = Date.now() + Math.random();
  rows.push({ id, mark:d.mark||'', sub_mark:d.sub_mark||'', lebar:d.lebar||'', panjang:d.panjang||'', qty:d.qty||1 });
  renderRows();
}
function removeRow(id) { rows = rows.filter(r => r.id !== id); renderRows(); }
function ur(id, f, v)  { const r = rows.find(x => x.id === id); if (r) r[f] = v; }

function renderRows() {
  document.getElementById('bq-rows').innerHTML = rows.map(r => `
    <div class="bq-row">
      <input type="text"   value="${r.mark}"     placeholder="P-01" oninput="ur(${r.id},'mark',this.value)">
      <input type="text"   value="${r.sub_mark}" placeholder="—"    oninput="ur(${r.id},'sub_mark',this.value)">
      <input type="number" value="${r.lebar}"    placeholder="mm"   oninput="ur(${r.id},'lebar',this.value)">
      <input type="number" value="${r.panjang}"  placeholder="mm"   oninput="ur(${r.id},'panjang',this.value)">
      <input type="number" value="${r.qty}"      placeholder="1" min="1" oninput="ur(${r.id},'qty',this.value)">
      <button class="btn btn-del" onclick="removeRow(${r.id})" title="Hapus">&times;</button>
    </div>`).join('');
}

function loadSample() {
  rows = [];
  SAMPLE_BQ.forEach(d => rows.push({ id: Date.now()+Math.random(), ...d }));
  renderRows();
  document.getElementById('mat-nama').value    = 'PL 8';
  document.getElementById('mat-tebal').value   = '8';
  document.getElementById('mat-panjang').value = '2400';
  document.getElementById('mat-lebar').value   = '1200';
  document.getElementById('mat-bj').value      = '7.85';
  document.getElementById('mat-kerf').value    = '5';
  updateBeratPlatPreview();
  document.getElementById('pane-result').classList.add('hidden');
  document.getElementById('input-error').classList.add('hidden');
}

function clearAll() {
  rows = [];
  renderRows();
  document.getElementById('pane-result').classList.add('hidden');
  document.getElementById('input-error').classList.add('hidden');
  rc();
}

function updateBeratPlatPreview() {
  const t  = parseFloat(document.getElementById('mat-tebal').value)   || 0;
  const p  = parseFloat(document.getElementById('mat-panjang').value) || 0;
  const l  = parseFloat(document.getElementById('mat-lebar').value)   || 0;
  const bj = parseFloat(document.getElementById('mat-bj').value)      || 7.85;
  if (t > 0 && p > 0 && l > 0) {
    document.getElementById('berat-plat-val').textContent = ((t/100)*(p/100)*(l/100)*bj).toFixed(3);
    document.getElementById('luas-plat-val').textContent  = (p/1000*l/1000).toFixed(3);
  }
}

async function calculate() {
  const errEl = document.getElementById('input-error');
  errEl.classList.add('hidden');

  const material = {
    nama:         document.getElementById('mat-nama').value,
    tebal:        parseFloat(document.getElementById('mat-tebal').value),
    panjang_plat: parseFloat(document.getElementById('mat-panjang').value),
    lebar_plat:   parseFloat(document.getElementById('mat-lebar').value),
    berat_jenis:  parseFloat(document.getElementById('mat-bj').value) || 7.85,
    kerf:         parseFloat(document.getElementById('mat-kerf').value) || 3,
  };

  if (!material.tebal || !material.panjang_plat || !material.lebar_plat) {
    errEl.textContent = 'Lengkapi ukuran material terlebih dahulu.';
    errEl.classList.remove('hidden');
    return;
  }
  if (rows.length === 0) {
    errEl.textContent = 'Tambahkan minimal 1 baris BQ.';
    errEl.classList.remove('hidden');
    return;
  }

  const potongan = rows.map(r => ({
    kode: r.mark, nama: r.sub_mark || r.mark,
    lebar: r.lebar, panjang: r.panjang,
    qty: r.qty, berat_aktual: '',
  }));

  try {
    const res  = await fetch('/api/calculate', {
      method:  'POST',
      headers: {'Content-Type':'application/json'},
      body:    JSON.stringify({material, potongan}),
    });
    const data = await res.json();
    if (!data.ok) {
      errEl.textContent = data.error || 'Terjadi kesalahan.';
      errEl.classList.remove('hidden');
      return;
    }
    renderResult(data);
    switchTab('result');
    window.scrollTo({top:0, behavior:'smooth'});
  } catch(e) {
    errEl.textContent = 'Gagal menghubungi server: ' + e.message;
    errEl.classList.remove('hidden');
  }
}

function renderResult(data) {
  rc();
  const codes = [...new Set(data.bq_analyzed.map(b => b.kode || b.nama))];
  codes.forEach(c => gc(c));
  renderMetrics(data.summary);
  renderBQAnalysis(data.bq_analyzed);
  renderLegend(codes);
  renderPlates(data.plates, data.config);
  renderDetailTable(data.plates);
}

function renderMetrics(s) {
  document.getElementById('metrics').innerHTML = `
    <div class="metric-card"><div class="metric-val">${s.total_plat}</div><div class="metric-label">Total Plat</div></div>
    <div class="metric-card"><div class="metric-val">${s.total_cuts}</div><div class="metric-label">Total Potongan</div></div>
    <div class="metric-card"><div class="metric-val">${s.efisiensi}%</div><div class="metric-label">Efisiensi</div></div>
    <div class="metric-card"><div class="metric-val">${s.total_waste}</div><div class="metric-label">Total Waste (m&sup2;)</div></div>
    <div class="metric-card"><div class="metric-val">${s.total_berat}</div><div class="metric-label">Total Berat (kg)</div></div>`;
}

function renderBQAnalysis(bq) {
  document.getElementById('bq-analysis-body').innerHTML = bq.map(b => `
    <tr>
      <td>${b.kode||'—'}</td>
      <td>${b.nama}</td>
      <td>${b.lebar} &times; ${b.panjang}</td>
      <td>${b.qty}</td>
      <td><strong>${b.berat_prediksi}</strong></td>
    </tr>`).join('');
}

function renderLegend(codes) {
  document.getElementById('legend').innerHTML = codes.map(c => {
    const col = gc(c);
    return `<div class="leg-item">
      <div class="leg-dot" style="background:${col.f};border:1px solid ${col.s}"></div>${c}
    </div>`;
  }).join('') + `
    <div class="leg-item">
      <div class="leg-dot" style="background:#f5f0e8;border:1px dashed #c8b89a"></div>Waste
    </div>`;
}

function renderPlates(plates, cfg) {
  const el = document.getElementById('plates-container');
  el.innerHTML = '';
  plates.forEach((pl, i) => {
    const wrap = document.createElement('div'); wrap.className = 'plat-wrap';
    const lbl  = document.createElement('div'); lbl.className  = 'plat-label';
    lbl.innerHTML = `<b>Plat #${i+1}</b><span>Efisiensi: ${pl.eff}% &nbsp;&middot;&nbsp; ${pl.cuts.length} potongan &nbsp;&middot;&nbsp; Waste: ${(pl.waste_area/1e6).toFixed(3)} m&sup2;</span>`;
    wrap.appendChild(lbl);
    wrap.appendChild(drawCanvas(pl, cfg));
    el.appendChild(wrap);
  });
}

function drawCanvas(pl, cfg) {
  const PW = cfg.panjang_plat, PH = cfg.lebar_plat;
  const CW = 860, CH = Math.round(CW * PH / PW);
  const sx = CW/PW, sy = CH/PH;
  const cv = document.createElement('canvas');
  cv.width = CW; cv.height = CH;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#faf6ec'; ctx.fillRect(0, 0, CW, CH);

  ctx.strokeStyle = '#e8dece'; ctx.lineWidth = .5;
  for (let x=500; x<PW; x+=500){ ctx.beginPath(); ctx.moveTo(x*sx,0); ctx.lineTo(x*sx,CH); ctx.stroke(); }
  for (let y=500; y<PH; y+=500){ ctx.beginPath(); ctx.moveTo(0,y*sy); ctx.lineTo(CW,y*sy); ctx.stroke(); }

  pl.cuts.forEach(c => {
    const col = gc(c.kode || c.nama);
    const rx  = Math.round(c.x*sx),  ry = Math.round(c.y*sy);
    const rw  = Math.round(c.pw*sx), rh = Math.round(c.ph*sy);

    ctx.fillStyle   = col.f; ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = col.s; ctx.lineWidth = 1;
    ctx.strokeRect(rx+.5, ry+.5, rw-1, rh-1);

    if (rw > 28 && rh > 16) {
      ctx.save();
      ctx.beginPath(); ctx.rect(rx+2, ry+2, rw-4, rh-4); ctx.clip();
      ctx.fillStyle = col.t; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = Math.min(11, Math.floor(rh * .26));
      ctx.font = `bold ${fs}px 'Courier New', monospace`;
      let lbl = (c.kode || c.nama);
      while (ctx.measureText(lbl).width > rw-6 && lbl.length > 3) lbl = lbl.slice(0,-1);
      if (lbl !== (c.kode||c.nama)) lbl += '..';
      if (rh > 32) {
        ctx.fillText(lbl, rx+rw/2, ry+rh/2 - fs*.6);
        ctx.font = `${Math.min(9, Math.floor(rh*.18))}px 'Courier New', monospace`;
        ctx.globalAlpha = .7;
        ctx.fillText(`${c.pw}x${c.ph}mm`, rx+rw/2, ry+rh/2 + fs*.8);
        ctx.fillText(`${c.berat_prediksi}kg`, rx+rw/2, ry+rh/2 + fs*1.9);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillText(lbl, rx+rw/2, ry+rh/2);
      }
      if (c.rotated) {
        ctx.font = '8px monospace'; ctx.globalAlpha = .5; ctx.textAlign = 'right';
        ctx.fillText('R', rx+rw-3, ry+10); ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    cv.addEventListener('mousemove', e => {
      const rect = cv.getBoundingClientRect();
      const mx = (e.clientX-rect.left)*(CW/rect.width);
      const my = (e.clientY-rect.top)*(CH/rect.height);
      if (mx>=rx && mx<=rx+rw && my>=ry && my<=ry+rh) showTip(e, c);
    });
  });

  cv.addEventListener('mouseleave', hideTip);

  ctx.strokeStyle = '#c8b89a'; ctx.lineWidth = 1;
  ctx.strokeRect(.5, .5, CW-1, CH-1);

  const sp=500*sx, bx=6, by=CH-10;
  ctx.strokeStyle='#a09070'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx+sp,by); ctx.stroke();
  [bx,bx+sp].forEach(x=>{ ctx.beginPath(); ctx.moveTo(x,by-3); ctx.lineTo(x,by+3); ctx.stroke(); });
  ctx.fillStyle='#a09070'; ctx.font='9px Courier New,monospace'; ctx.textAlign='left';
  ctx.fillText('500mm', bx, by-5);
  ctx.fillStyle='#c8b89a'; ctx.textAlign='right';
  ctx.fillText(`${PW}x${PH}mm`, CW-4, CH-4);

  return cv;
}

function renderDetailTable(plates) {
  const tableRows = plates.map((pl, i) => {
    const berat = pl.cuts.reduce((s,c) => s+c.berat_prediksi, 0).toFixed(3);
    const wc    = pl.waste_area < 500000 ? 'b-green' : pl.waste_area < 1500000 ? 'b-blue' : 'b-red';
    const cuts  = pl.cuts.map(c => {
      const col = gc(c.kode||c.nama);
      return `<span class="badge" style="background:${col.f};color:${col.t};border:1px solid ${col.s}">${c.kode||c.nama} ${c.pw}&times;${c.ph}${c.rotated?' R':''}</span>`;
    }).join(' ');
    return `<tr>
      <td style="font-weight:700;text-align:center">#${i+1}</td>
      <td>${cuts}</td>
      <td>${pl.eff}%</td>
      <td><span class="badge ${wc}">${(pl.waste_area/1e6).toFixed(3)} m&sup2;</span></td>
      <td>${berat} kg</td>
    </tr>`;
  }).join('');

  document.getElementById('detail-table').innerHTML = `
    <table>
      <thead><tr>
        <th style="width:50px;text-align:center">Plat</th>
        <th>Potongan</th><th>Efisiensi</th><th>Waste</th><th>Berat</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
}

function showTip(e, c) {
  const tip = document.getElementById('tooltip');
  tip.innerHTML = `<strong>${c.kode||''} ${c.nama}</strong><br>${c.pw} x ${c.ph} mm${c.rotated?' (dirotasi)':''}<br>Berat: <strong>${c.berat_prediksi} kg</strong>`;
  tip.style.display = 'block';
  tip.style.left    = (e.clientX+14)+'px';
  tip.style.top     = (e.clientY-50)+'px';
}
function hideTip() { document.getElementById('tooltip').style.display='none'; }

document.addEventListener('DOMContentLoaded', () => {
  addRow();
  updateBeratPlatPreview();
  ['mat-tebal','mat-panjang','mat-lebar','mat-bj'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateBeratPlatPreview);
  });
});

function onDragOver(e)   { e.preventDefault(); document.getElementById('upload-area').classList.add('dragover'); }
function onDragLeave()   { document.getElementById('upload-area').classList.remove('dragover'); }
function onDrop(e)       { e.preventDefault(); document.getElementById('upload-area').classList.remove('dragover'); const f=e.dataTransfer.files[0]; if(f) processExcelFile(f); }
function onFileChange(e) { const f=e.target.files[0]; if(f) processExcelFile(f); }

async function processExcelFile(file) {
  const statusEl = document.getElementById('upload-status');
  statusEl.className = '';
  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Membaca file...';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res  = await fetch('/api/parse-excel', {method:'POST', body:formData});
    const data = await res.json();

    if (!data.ok) {
      statusEl.className   = 'status-err';
      statusEl.textContent = data.error;
      return;
    }

    rows = [];
    data.potongan.forEach(p => {
      rows.push({
        id:       Date.now()+Math.random(),
        mark:     p.kode    || '',
        sub_mark: p.nama    || p.kode || '',
        lebar:    p.lebar   || '',
        panjang:  p.panjang || '',
        qty:      p.qty     || 1,
      });
    });
    renderRows();

    const hasWarn = data.warnings && data.warnings.length > 0;
    statusEl.className   = hasWarn ? 'status-warn' : 'status-ok';
    statusEl.textContent = data.info + (hasWarn ? '\n' + data.warnings.join('\n') : '');
    document.getElementById('excel-file').value = '';

  } catch(e) {
    statusEl.className   = 'status-err';
    statusEl.textContent = 'Gagal upload: ' + e.message;
  }
}