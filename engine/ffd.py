# ═══════════════════════════════════════════════════
#  engine/ffd.py  —  Logika cutting plan FFD 2D
# ═══════════════════════════════════════════════════

STEEL_DENSITY = 7.85   # kg/dm³  (= 7850 kg/m³)
IRREGULARITY_THRESHOLD = 0.95   # kalau ratio < 95% → dianggap irregular


def hitung_berat_teoritis(tebal_mm, lebar_mm, panjang_mm, berat_jenis=STEEL_DENSITY):
    """
    Hitung berat teoritis asumsi rectangle penuh.
    Konversi mm → dm terlebih dahulu (1 dm = 100 mm).
    Berat (kg) = volume (dm³) × berat_jenis (kg/dm³)
    """
    t = tebal_mm / 100
    l = lebar_mm / 100
    p = panjang_mm / 100
    return round(t * l * p * berat_jenis, 4)


def analisis_potongan(item: dict, tebal_mm: float, berat_jenis: float = STEEL_DENSITY) -> dict:
    """
    Analisis tiap potongan:
    - Hitung berat teoritis (rectangle penuh)
    - Kalau berat aktual diisi → hitung ratio → deteksi irregular
    - Kalau tidak diisi → prediksi berat = berat teoritis

    Return dict dengan field tambahan:
        berat_teoritis, berat_prediksi, ratio, is_irregular, shape_note
    """
    lebar  = float(item["lebar"])
    panjang = float(item["panjang"])

    berat_teori = hitung_berat_teoritis(tebal_mm, lebar, panjang, berat_jenis)

    berat_aktual_raw = item.get("berat_aktual", "")
    berat_aktual = None
    if berat_aktual_raw not in (None, "", 0, "0"):
        try:
            berat_aktual = float(berat_aktual_raw)
        except ValueError:
            berat_aktual = None

    if berat_aktual is not None and berat_teori > 0:
        ratio = berat_aktual / berat_teori
        is_irregular = ratio < IRREGULARITY_THRESHOLD
        if is_irregular:
            shape_note = (
                f"⚠ Kemungkinan irregular — berat aktual {berat_aktual:.3f} kg "
                f"({ratio*100:.1f}% dari teoritis {berat_teori:.3f} kg). "
                f"Bentuk tidak diketahui, FFD pakai bounding box {lebar:.0f}×{panjang:.0f} mm."
            )
        else:
            shape_note = (
                f"✔ Rectangle — berat aktual {berat_aktual:.3f} kg "
                f"({ratio*100:.1f}% dari teoritis {berat_teori:.3f} kg)."
            )
        berat_prediksi = berat_aktual
    else:
        ratio = 1.0
        is_irregular = False
        shape_note = f"Berat tidak diisi — prediksi rectangle penuh: {berat_teori:.3f} kg."
        berat_prediksi = berat_teori

    return {
        **item,
        "lebar":          lebar,
        "panjang":        panjang,
        "berat_teoritis": berat_teori,
        "berat_prediksi": round(berat_prediksi, 4),
        "berat_aktual":   berat_aktual,
        "ratio":          round(ratio, 4),
        "is_irregular":   is_irregular,
        "shape_note":     shape_note,
    }


# ─────────────────────────────────────────────────
#  Overlap check
# ─────────────────────────────────────────────────
def _overlap(cuts, nx, ny, nw, nh, kerf):
    """Return True kalau (nx,ny,nw,nh) overlap dengan salah satu cut yang ada."""
    k = kerf
    for c in cuts:
        no_overlap = (
            nx + nw + k <= c["x"] or
            c["x"] + c["pw"] + k <= nx or
            ny + nh + k <= c["y"] or
            c["y"] + c["ph"] + k <= ny
        )
        if not no_overlap:
            return True
    return False


# ─────────────────────────────────────────────────
#  Cari posisi FFD di satu plat
# ─────────────────────────────────────────────────
def _ffd_pos(cuts, pw, ph, PW, PH, kerf):
    """
    Kumpulkan kandidat posisi: (0,0) + pojok kanan & bawah tiap cut.
    Urutkan y dulu (atas ke bawah), lalu x (kiri ke kanan).
    Return dict posisi atau None.
    """
    cands = [(0, 0)]
    for c in cuts:
        cands.append((c["x"] + c["pw"] + kerf, c["y"]))
        cands.append((c["x"], c["y"] + c["ph"] + kerf))

    cands.sort(key=lambda p: (p[1], p[0]))

    for (x, y) in cands:
        # Orientasi normal
        if x + pw <= PW and y + ph <= PH and not _overlap(cuts, x, y, pw, ph, kerf):
            return {"x": x, "y": y, "pw": pw, "ph": ph, "rotated": False}
        # Rotasi 90°
        if pw != ph and x + ph <= PW and y + pw <= PH and not _overlap(cuts, x, y, ph, pw, kerf):
            return {"x": x, "y": y, "pw": ph, "ph": pw, "rotated": True}

    return None


# ─────────────────────────────────────────────────
#  FFD utama
# ─────────────────────────────────────────────────
def run_ffd(pieces: list, plate_w: float, plate_h: float, kerf: float = 3.0) -> list:
    """
    Jalankan FFD 2D.
    pieces  : list dict dengan field 'lebar', 'panjang', dll (sudah di-expand per qty)
    plate_w : lebar plat (mm)
    plate_h : tinggi plat (mm)
    kerf    : kerugian potong (mm)

    Return: list plat, tiap plat berisi list cuts dengan koordinat (x, y, pw, ph).
    """
    # Urutkan dari luas terbesar ke terkecil (kunci FFD)
    sorted_pieces = sorted(pieces, key=lambda p: p["lebar"] * p["panjang"], reverse=True)

    plates = []  # list of {"cuts": [...]}

    for piece in sorted_pieces:
        pw = piece["lebar"]
        ph = piece["panjang"]

        placed = False
        for plate in plates:
            pos = _ffd_pos(plate["cuts"], pw, ph, plate_w, plate_h, kerf)
            if pos:
                plate["cuts"].append({**piece, **pos})
                placed = True
                break

        if not placed:
            new_plate = {"cuts": []}
            pos = _ffd_pos(new_plate["cuts"], pw, ph, plate_w, plate_h, kerf)
            if pos:
                new_plate["cuts"].append({**piece, **pos})
            plates.append(new_plate)

    return plates


# ─────────────────────────────────────────────────
#  Hitung statistik tiap plat
# ─────────────────────────────────────────────────
def calc_stats(plates: list, plate_w: float, plate_h: float) -> list:
    """Tambahkan used_area, waste_area, eff (%) ke tiap plat."""
    result = []
    total_area = plate_w * plate_h
    for plate in plates:
        used = sum(c["pw"] * c["ph"] for c in plate["cuts"])
        waste = total_area - used
        eff = round(used / total_area * 100, 1) if total_area > 0 else 0
        result.append({
            **plate,
            "used_area":  round(used, 2),
            "waste_area": round(waste, 2),
            "eff":        eff,
        })
    return result


def overall_eff(plates: list, plate_w: float, plate_h: float) -> float:
    total_used  = sum(p["used_area"] for p in plates)
    total_area  = len(plates) * plate_w * plate_h
    return round(total_used / total_area * 100, 1) if total_area > 0 else 0
