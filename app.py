# ═══════════════════════════════════════════════════
#  app.py  —  Flask server cutting plan FFD
#  Jalankan: python app.py
#  Buka:     http://localhost:5000
# ═══════════════════════════════════════════════════

import os
import re
import openpyxl
from flask import Flask, render_template, request, jsonify, send_file
from engine.ffd import (
    analisis_potongan,
    run_ffd,
    calc_stats,
    overall_eff,
    hitung_berat_teoritis,
    STEEL_DENSITY,
)

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # max upload 10MB

TEMPLATE_PATH = os.path.join(
    os.path.dirname(__file__),
    'static', 'templates_excel', 'template_upload_cutting_plan.xlsx'
)


# ──────────────────────────────────────────
#  Helper: parse kolom Profile → lebar (mm)
#  Contoh input: "P     180x 8"  →  180.0
#                "P   190.1x 8"  →  190.1
# ──────────────────────────────────────────
def _parse_lebar_dari_profile(profile_str: str):
    """
    Ekstrak nilai lebar dari string profile seperti 'P     180x 8' atau 'P   190.1x 8'.
    Return float lebar (mm), atau None jika gagal.
    """
    if not profile_str:
        return None
    # Cari angka pertama setelah 'P' dan spasi, sebelum 'x'
    m = re.search(r'P\s+([\d.]+)\s*[xX]', str(profile_str))
    if m:
        return float(m.group(1))
    return None


# ──────────────────────────────────────────
#  Halaman utama
# ──────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')


# ──────────────────────────────────────────
#  Download template Excel
# ──────────────────────────────────────────
@app.route('/api/template')
def download_template():
    return send_file(
        TEMPLATE_PATH,
        as_attachment=True,
        download_name='template_upload_cutting_plan.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )


# ──────────────────────────────────────────
#  Upload & parse Excel → return JSON ke frontend
#  Format kolom (Sheet1, mulai baris 2):
#    A: Mark | B: Sub Mark | C: QTY | D: Profile (P LxT) | E: Length
# ──────────────────────────────────────────
@app.route('/api/parse-excel', methods=['POST'])
def parse_excel():
    if 'file' not in request.files:
        return jsonify({'error': 'Tidak ada file yang dikirim.'}), 400

    f = request.files['file']
    if not f.filename.endswith(('.xlsx', '.xls')):
        return jsonify({'error': 'Format file harus .xlsx atau .xls'}), 400

    try:
        wb = openpyxl.load_workbook(f, data_only=True)

        # Cari sheet: utamakan 'Sheet1', fallback ke sheet pertama
        if 'Sheet1' in wb.sheetnames:
            ws = wb['Sheet1']
        else:
            ws = wb.active

        potongan = []
        errors   = []

        # Baca header baris 1, data mulai baris 2
        for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            # Ambil 5 kolom: A=Mark, B=SubMark, C=QTY, D=Profile, E=Length
            cols     = (list(row) + [None] * 5)[:5]
            mark, sub_mark, qty_raw, profile_raw, length_raw = cols

            # Skip baris benar-benar kosong
            if all(v is None or str(v).strip() == '' for v in cols):
                continue

            # Gabung Mark + Sub Mark jadi kode & nama
            kode = str(mark or '').strip()
            nama = str(sub_mark or '').strip() if sub_mark else kode

            # Parse Profile → lebar
            lebar = _parse_lebar_dari_profile(profile_raw)

            # Validasi
            row_errors = []
            if lebar is None:
                row_errors.append(f'Profile tidak bisa diparsing: "{profile_raw}"')
            if length_raw is None or str(length_raw).strip() == '':
                row_errors.append('Length (Panjang) kosong')
            if qty_raw is None or str(qty_raw).strip() == '':
                row_errors.append('QTY kosong')

            if row_errors:
                errors.append(f'Baris {row_idx} ({kode or "?"}): {", ".join(row_errors)}')
                continue

            try:
                potongan.append({
                    'kode':         kode,
                    'nama':         nama if nama else kode,
                    'lebar':        float(lebar),
                    'panjang':      float(length_raw),
                    'qty':          int(float(qty_raw)),
                    'berat_aktual': '',   # tidak ada di template ini
                    'keterangan':   str(profile_raw or '').strip(),  # simpan profile asli
                })
            except (ValueError, TypeError) as e:
                errors.append(f'Baris {row_idx} ({kode or "?"}): nilai tidak valid — {e}')

        if not potongan:
            return jsonify({'error': 'Tidak ada data potongan valid. '
                                     'Pastikan file menggunakan format kolom: '
                                     'Mark | Sub Mark | QTY | Profile | Length'}), 400

        return jsonify({
            'ok':       True,
            'potongan': potongan,
            'warnings': errors,
            'info':     f'{len(potongan)} baris berhasil dibaca dari Excel.'
                        + (f' {len(errors)} baris dilewati.' if errors else ''),
            # Tidak ada material dari file — frontend pakai nilai form yang sudah ada
            'material': None,
        })

    except Exception as e:
        return jsonify({'error': f'Gagal membaca Excel: {str(e)}'}), 500


# ──────────────────────────────────────────
#  Hitung cutting plan (dari form atau Excel)
# ──────────────────────────────────────────
@app.route('/api/calculate', methods=['POST'])
def calculate():
    try:
        data         = request.get_json(force=True)
        mat          = data['material']
        potongan     = data['potongan']

        tebal        = float(mat['tebal'])
        lebar_plat   = float(mat['lebar_plat'])
        panjang_plat = float(mat['panjang_plat'])
        berat_jenis  = float(mat.get('berat_jenis', STEEL_DENSITY))
        kerf         = float(mat.get('kerf', 5))

        if tebal <= 0 or lebar_plat <= 0 or panjang_plat <= 0:
            return jsonify({'error': 'Ukuran material harus lebih dari 0.'}), 400

        bq_analyzed = []
        for item in potongan:
            qty      = int(item.get('qty', 1))
            analyzed = analisis_potongan(item, tebal, berat_jenis)
            analyzed['qty'] = qty
            bq_analyzed.append(analyzed)

        pieces = []
        for item in bq_analyzed:
            for _ in range(item['qty']):
                pieces.append({**item})

        if not pieces:
            return jsonify({'error': 'Tidak ada potongan valid.'}), 400

        too_large = [p for p in pieces if p['lebar'] > lebar_plat or p['panjang'] > panjang_plat]
        if too_large:
            names = list({p['nama'] for p in too_large})
            return jsonify({'error': f"Potongan lebih besar dari plat ({panjang_plat}×{lebar_plat}mm): {', '.join(names)}"}), 400

        plates_raw = run_ffd(pieces, panjang_plat, lebar_plat, kerf)
        plates     = calc_stats(plates_raw, panjang_plat, lebar_plat)
        eff        = overall_eff(plates, panjang_plat, lebar_plat)

        total_cuts  = sum(len(p['cuts']) for p in plates)
        total_berat = round(sum(c['berat_prediksi'] for p in plates for c in p['cuts']), 3)
        total_waste = round(sum(p['waste_area'] for p in plates) / 1e6, 4)
        berat_plat  = round(hitung_berat_teoritis(tebal, lebar_plat, panjang_plat, berat_jenis) * len(plates), 3)

        return jsonify({
            'ok': True,
            'summary': {
                'total_plat':  len(plates),
                'total_cuts':  total_cuts,
                'efisiensi':   eff,
                'total_waste': total_waste,
                'total_berat': total_berat,
                'berat_plat':  berat_plat,
            },
            'plates':      plates,
            'bq_analyzed': bq_analyzed,
            'config': {
                'panjang_plat': panjang_plat,
                'lebar_plat':   lebar_plat,
                'tebal':        tebal,
                'kerf':         kerf,
            }
        })

    except KeyError as e:
        return jsonify({'error': f'Field tidak lengkap: {e}'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)