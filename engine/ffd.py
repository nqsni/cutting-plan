import re
import math


def parse_spec(spec_raw):
    """
    Parse spesifikasi material → dict info.

    Aturan pengelompokan (group_key):
      PLAT   → per TEBAL saja   → PL 4.5×2089 dan PL 4.5×1414 → group_key "PL_4.5"
      PROFIL → per spesifikasi lengkap → RHS 50×50×2.3 ≠ RHS 100×100×6
      PCS    → per spesifikasi lengkap

    Returns dict:
      kategori  : 'PLAT' | 'PROFIL' | 'PCS'
      group_key : string kunci pengelompokan
      label     : nama tampilan grup di UI
      dimensi   : {'tebal', 'lebar'} untuk PLAT, {} untuk yang lain
      bisa_cut  : bool
      raw_length: int default panjang batang (hanya untuk PROFIL)
    """
    s = str(spec_raw or '').strip()
    if not s:
        return {
            'kategori': 'PCS', 'group_key': '__PCS_KOSONG__',
            'label': 'Tanpa Spesifikasi', 'dimensi': {},
            'bisa_cut': False, 'raw_length': 0,
        }

    s_upper = s.upper()

    # ── PLAT: PL 12X200, PL 4.5X50, P 180X8 ──────────────────────────────
    # group_key = "PL_<tebal>"  (gabungkan semua tebal yang sama)
    # lebar per-item disimpan di dimensi['lebar'], dipakai saat bikin pieces
    plat_match = re.match(r'^(PL|P)\s*([\d.,]+)\s*[Xx×]\s*([\d.,]+)', s, re.I)
    if plat_match:
        tebal = _parse_num(plat_match.group(2))
        lebar = _parse_num(plat_match.group(3))
        gk = f"PL_{_fmt(tebal)}"
        return {
            'kategori': 'PLAT',
            'group_key': gk,
            'label': f"PL t={_fmt(tebal)} mm",
            'dimensi': {'tebal': tebal, 'lebar': lebar},
            'bisa_cut': True,
            'raw_length': 0,
        }

    # ── PROFIL BATANG: group_key = spesifikasi lengkap (uppercase, strip) ─
    profil_patterns = [
        r'^(RHS|SHS|CHS)\s*([\d.,]+)',
        r'^(WF|IWF|HEB|HEA|IPE|INP|UNP|UPE|CNP|PFC)\s*([\d.,]+)',
        r'^(L|SIKU)\s*([\d.,]+)',
        r'^(H)\s*([\d.,]+)',
        r'^(FB|RB|FLAT BAR|ROUND BAR)\s*([\d.,]+)',
        r'^(PIPE|PIPA|HSS)\s*([\d.,]+)',
        r'^(C|CHANNEL)\s*([\d.,]+)',
        r'^(T|TEE)\s*([\d.,]+)',
        r'^(BEAM|GIRDER|COLUMN)\s*([\d.,]+)',
    ]
    for pat in profil_patterns:
        if re.match(pat, s_upper):
            norm = s_upper.strip()
            return {
                'kategori': 'PROFIL', 'group_key': norm,
                'label': norm, 'dimensi': {},
                'bisa_cut': True, 'raw_length': 12000,
            }

    # Profil prefix tidak dikenali tapi ada angka → tetap PROFIL
    if re.match(r'^[A-Z]+\s*[\d.,]+', s_upper):
        norm = s_upper.strip()
        return {
            'kategori': 'PROFIL', 'group_key': norm,
            'label': norm, 'dimensi': {},
            'bisa_cut': True, 'raw_length': 12000,
        }

    # ── PCS: baut, hardware, dll ──────────────────────────────────────────
    return {
        'kategori': 'PCS', 'group_key': s_upper.strip(),
        'label': s, 'dimensi': {},
        'bisa_cut': False, 'raw_length': 0,
    }


def _parse_num(s):
    return float(str(s).replace(',', '.'))


def _fmt(n):
    if n is None:
        return '?'
    if n == int(n):
        return str(int(n))
    return str(n)


# ── Berat ──────────────────────────────────────────────────────────────────
BJ_BAJA = 7.85e-6  # kg/mm³

def hitung_berat(spec_info, panjang_mm, bj=None):
    """Hitung berat teoritis (kg). Profil kompleks → 0."""
    if bj is None:
        bj = BJ_BAJA
    if not spec_info or not spec_info.get('bisa_cut'):
        return 0
    return 0


# ── FFD 1D ─────────────────────────────────────────────────────────────────
def run_ffd_1d(pieces, raw_length, kerf=0):
    """
    First Fit Decreasing 1D.
    pieces: [{'length': float, 'drawing_no': str, 'label': str}, ...]
    Returns: [{'pieces': [...], 'used': float, 'remaining': float, 'error': bool}, ...]
    """
    sorted_pieces = sorted(pieces, key=lambda p: p['length'], reverse=True)
    bars = []

    for piece in sorted_pieces:
        placed = False
        for bar in bars:
            if bar['remaining'] >= piece['length'] + (kerf if bar['pieces'] else 0):
                cut = piece['length'] + (kerf if bar['pieces'] else 0)
                bar['pieces'].append({**piece})
                bar['used'] += cut
                bar['remaining'] -= cut
                placed = True
                break

        if not placed:
            if piece['length'] > raw_length:
                bars.append({
                    'pieces': [{**piece, 'warning': 'Melebihi panjang raw material'}],
                    'used': piece['length'], 'remaining': 0, 'error': True,
                })
            else:
                bars.append({
                    'pieces': [{**piece}],
                    'used': piece['length'],
                    'remaining': raw_length - piece['length'],
                    'error': False,
                })

    return bars


# ── FFD 2D ─────────────────────────────────────────────────────────────────
def run_ffd_2d(pieces, plate_w, plate_h, kerf=5):
    """
    First Fit Decreasing 2D (candidate-corner placement + rotation).
    pieces: [{'w': float, 'h': float, 'drawing_no': str, 'label': str}, ...]
    Returns: [{'pieces': [...with x,y,w,h,rotated], 'plate_w', 'plate_h',
                'used_area', 'efficiency'}, ...]
    """
    sorted_pieces = sorted(pieces, key=lambda p: p['w'] * p['h'], reverse=True)
    plates = []

    for piece in sorted_pieces:
        placed = False
        for plate in plates:
            if _try_place_2d(plate, piece, plate_w, plate_h, kerf):
                placed = True
                break

        if not placed:
            new_plate = {
                'pieces': [], 'plate_w': plate_w, 'plate_h': plate_h,
                'used_area': 0,
            }
            if not _try_place_2d(new_plate, piece, plate_w, plate_h, kerf):
                new_plate['pieces'].append({
                    **piece, 'x': 0, 'y': 0, 'rotated': False,
                    'warning': 'Melebihi ukuran plate',
                })
                new_plate['used_area'] += piece['w'] * piece['h']
            plates.append(new_plate)

    total_plate_area = plate_w * plate_h
    for plate in plates:
        plate['efficiency'] = round(
            plate['used_area'] / total_plate_area * 100, 1
        ) if total_plate_area > 0 else 0

    return plates


def _try_place_2d(plate, piece, plate_w, plate_h, kerf):
    candidates = _get_candidates(plate, kerf)
    for (cx, cy) in candidates:
        for (pw, ph, rotated) in [
            (piece['w'], piece['h'], False),
            (piece['h'], piece['w'], True),
        ]:
            # Piece harus muat di dalam plate (tanpa tambahan kerf di tepi luar)
            if cx + pw > plate_w or cy + ph > plate_h:
                continue
            if _no_overlap(plate, cx, cy, pw, ph, kerf):
                plate['pieces'].append({
                    **piece, 'x': cx, 'y': cy,
                    'w': pw, 'h': ph, 'rotated': rotated,
                })
                plate['used_area'] += piece['w'] * piece['h']
                return True
    return False


def _get_candidates(plate, kerf=0):
    """
    Kandidat posisi = (0,0) plus pojok kanan dan bawah tiap piece
    yang sudah ada, masing-masing ditambah kerf agar piece baru
    tidak menempel langsung (ada celah gergaji).
    """
    candidates = [(0, 0)]
    for p in plate['pieces']:
        # Pojok kanan bawah piece + kerf di arah kanan
        candidates.append((p['x'] + p['w'] + kerf, p['y']))
        # Pojok kiri bawah piece + kerf di arah bawah
        candidates.append((p['x'], p['y'] + p['h'] + kerf))
    # Urutkan: y dulu, lalu x (isi dari pojok kiri-atas)
    candidates.sort(key=lambda c: (c[1], c[0]))
    seen, unique = set(), []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    return unique


def _no_overlap(plate, x, y, w, h, kerf):
    """
    Cek apakah piece baru (x,y,w,h) tidak bertumpuk dengan piece yang ada.
    Kerf = jarak minimum antar piece (celah gergaji).
    Dua rect TIDAK overlap jika salah satu kondisi ini benar:
      - new_right  + kerf <= existing_left
      - new_bottom + kerf <= existing_top
      - existing_right  + kerf <= new_left
      - existing_bottom + kerf <= new_top
    """
    new_r = x + w
    new_b = y + h
    for p in plate['pieces']:
        px, py, pw, ph = p['x'], p['y'], p['w'], p['h']
        pr = px + pw
        pb = py + ph
        # Jika TIDAK ada separasi di salah satu sumbu → overlap
        if not (new_r + kerf <= px or
                pr + kerf <= x or
                new_b + kerf <= py or
                pb + kerf <= y):
            return False
    return True