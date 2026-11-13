# NASA true-colour snapshots for the storm archive (NASA Worldview Snapshots / GIBS; NASA open data).
# One snapshot per selected storm: the daytime pass on the day of peak intensity. 2016+ uses VIIRS
# (Suomi-NPP, ~13:30 local, no gaps between orbits); before that Terra MODIS (~10:30 local), with
# The pass that covers the storm best on its own is used; no-data areas are patched (feathered,
# brightness-matched) from the other same-day pass, then the same satellite a day either side, then
# smoothed over. Eye registration as in tools/sat.py, but only accepted when the
# eye is clearly darker than the ring around it; otherwise the photo is placed by the NOAA position.
# usage: python3 tools/satlib.py src/archive.js outDir [ids...]   (default: all major hurricanes)
import sys, os, json, math, time, io, urllib.request, concurrent.futures as cf
import numpy as np
import cv2
from PIL import Image, ImageFilter

ARCH, OUT = sys.argv[1], sys.argv[2]
s = open(ARCH).read(); A = json.loads(s[s.index('['):s.rindex(']') + 1])
REDO = set(os.environ.get('REDO', '').split(','))
ids = set(sys.argv[3:]) or {x['id'] for x in A if x['cat'] in ('3', '4', '5')}
WVS = 'https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&TIME={d}&BBOX={s},{w},{n},{e}&CRS=EPSG:4326&LAYERS={L}&FORMAT=image/jpeg&WIDTH={W}&HEIGHT={H}'
tOf = lambda t: time.mktime(time.strptime(t, '%Y%m%d%H%M')) - time.timezone

def fetch(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r: return Image.open(io.BytesIO(r.read())).convert('RGB')
        except Exception as e:
            err = e; time.sleep(3 * (k + 1))
    raise err

def track_at(x, t):
    T = [tOf(v) for v in x['t']]
    i = max(0, min(len(T) - 2, max(k for k in range(len(T)) if T[k] <= t) if t >= T[0] else 0))
    f = min(1, max(0, (t - T[i]) / (T[i + 1] - T[i])))
    return (x['lat'][i] + (x['lat'][i + 1] - x['lat'][i]) * f) / 10, (x['lon'][i] + (x['lon'][i + 1] - x['lon'][i]) * f) / 10

TERRA, AQUA = 'MODIS_Terra_CorrectedReflectance_TrueColor', 'MODIS_Aqua_CorrectedReflectance_TrueColor'
SNPP, N20 = 'VIIRS_SNPP_CorrectedReflectance_TrueColor', 'VIIRS_NOAA20_CorrectedReflectance_TrueColor'
HLOC = {TERRA: 10.5, AQUA: 13.5, SNPP: 13.5, N20: 13.5}             # local overpass hour
NAME = {TERRA: 'MODIS Terra', AQUA: 'MODIS Aqua', SNPP: 'VIIRS Suomi-NPP', N20: 'VIIRS NOAA-20'}
gaps = lambda a: a.sum(2) < 14                                       # no-data (black) pixels

def patch(base, other, feather):
    """Fill base's no-data from other where other has data: brightness-matched in a band round the
    gap, blended over `feather` px into base, so the join is soft rather than a hard line."""
    gb, go = gaps(base), gaps(other)
    need = (gb & ~go).astype(np.uint8)
    if not need.any(): return base
    k = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    band = (cv2.dilate(need, k(feather * 3)) > 0) & ~gb & ~go
    o = other.copy()
    if band.sum() > 500:                                             # match the two passes' brightness
        o *= (base[band].mean(0) + 1) / (other[band].mean(0) + 1)
    w = cv2.GaussianBlur(cv2.dilate(need, k(feather)).astype(np.float32), (0, 0), feather / 2)
    w = np.where(go, 0, np.maximum(w, need))[..., None]              # never blend in other's no-data
    return base * (1 - w) + o * w

def inpaint(a):
    m = gaps(a).astype(np.uint8)
    if not m.any(): return a
    return cv2.inpaint(a.clip(0, 255).astype(np.uint8), cv2.dilate(m, np.ones((5, 5), np.uint8)), 15, cv2.INPAINT_TELEA).astype(np.float32)

def one(x):
    sid = x['id']; od = os.path.join(OUT, sid)
    if os.path.exists(os.path.join(od, 'meta.json')) and sid not in REDO: return sid, 'cached'
    k = max(range(len(x['v'])), key=lambda i: x['v'][i]); tp = tOf(x['t'][k]); lat0, lon0 = x['lat'][k] / 10, x['lon'][k] / 10
    day = time.strftime('%Y-%m-%d', time.gmtime(tp + lon0 / 15 * 3600))          # local date at the storm
    viirs = x['year'] >= 2016          # VIIRS corrected reflectance in GIBS starts late 2015
    t0 = tOf(day.replace('-', '') + '0000') - lon0 / 15 * 3600
    lat, lon = track_at(x, t0 + 12 * 3600)                                         # box centred on local noon
    WB = [lon - 10, lat + 8, lon + 10, lat - 8]                                      # wide box: W, N, E, S
    CB = [lon - 1.8, lat + 1.8, lon + 1.8, lat - 1.8]
    if WB[0] < -180 or WB[2] > 180: return sid, 'skipped: crosses the dateline'
    dshift = lambda dd: time.strftime('%Y-%m-%d', time.gmtime(tOf(day.replace('-', '') + '1200') + dd * 86400))
    get = lambda L, B, W, H, dd=0: np.asarray(fetch(WVS.format(d=dshift(dd), s=B[3], w=B[0], n=B[1], e=B[2], L=L, W=W, H=H))).astype(np.float32)
    yy, xx = np.mgrid[0:1024, 0:1280]; centre = np.hypot((xx - 640) / 64, (yy - 512) / 64) < 6   # within 6 deg
    # primary pass: the one image that covers the storm best on its own (no join through the storm)
    cands = [SNPP, N20, AQUA] if viirs else [TERRA, AQUA]
    imgs = {L: get(L, WB, 1280, 1024) for L in cands[:2]}
    if viirs and min(gaps(v)[centre].mean() for v in imgs.values()) > 0.3: imgs[AQUA] = get(AQUA, WB, 1280, 1024)
    P = min(imgs, key=lambda L: (gaps(imgs[L])[centre].mean() > 0.002, gaps(imgs[L])[centre].mean() + 0.1 * gaps(imgs[L]).mean(), cands.index(L)))
    t = imgs[P]; used = [NAME[P]]
    for L, v in imgs.items():                                        # then the other same-day pass
        if L != P and gaps(t).mean() > 0.0005 and (gaps(t) & ~gaps(v)).any(): t = patch(t, v, 24); used.append(NAME[L])
    for dd in (-1, 1):                                               # then the same satellite a day either side
        if gaps(t).mean() > 0.0005: t = patch(t, get(P, WB, 1280, 1024, dd), 24); used.append(f'{NAME[P]} {"previous" if dd < 0 else "next"} day (edges)')
    left = float(gaps(t).mean()); t = inpaint(t)                     # last specks: smoothed over
    tpass = t0 + HLOC[P] * 3600; lat, lon = track_at(x, tpass)
    img = Image.fromarray(t.clip(0, 255).astype(np.uint8)); H, W = 1024, 1280; still = left
    c = get(P, CB, 1400, 1400)
    for L in [l for l in cands if l != P][:1]:
        if gaps(c).mean() > 0.0005: c = patch(c, get(L, CB, 1400, 1400), 30)
    if gaps(c).mean() > 0.0005: c = patch(c, get(P, CB, 1400, 1400, 1 if HLOC[P] < 12 else -1), 30)
    core = Image.fromarray(inpaint(c).clip(0, 255).astype(np.uint8))
    # eye, found in the close-up (~0.3 km/px): darkest blurred min-channel spot within 0.6 deg of the NOAA
    # position, accepted only if clearly darker than the ring 15-35 km out; else placed by the NOAA position
    cm = np.asarray(core.filter(ImageFilter.GaussianBlur(4))).min(2).astype(np.float32); N = 1400; ppd = N / 3.6
    R = int(0.6 * ppd); c0 = N // 2; sub = cm[c0 - R:c0 + R, c0 - R:c0 + R]
    iy, ix = np.unravel_index(sub.argmin(), sub.shape); ex, ey = c0 - R + ix, c0 - R + iy
    yy, xx = np.mgrid[0:N, 0:N]; d = np.hypot(xx - ex, yy - ey) / ppd * 111
    rmask = (d > 15) & (d < 35); ring = float(np.median(cm[rmask])) if rmask.any() else 0.0
    eye = float(cm[ey, ex]); contrast = ring - eye       # darkest point, so pinhole eyes count too
    found = bool(contrast > 50 and ring > 140)
    elon, elat = (CB[0] + ex / N * 3.6, CB[1] - ey / N * 3.6) if found else (lon, lat)
    os.makedirs(od, exist_ok=True)
    img.save(od + '/wide.jpg', quality=82, optimize=True)
    core.save(od + '/core.jpg', quality=84, optimize=True)
    meta = {'t': int(tpass * 1000), 'src': NAME[P], 'used': used,
            'wide': [round(v, 3) for v in WB], 'core': [round(v, 3) for v in CB], 'eye': [round(float(elon), 4), round(float(elat), 4)],
            'eyeFound': bool(found), 'contrast': round(contrast, 1), 'gaps': round(float(still), 4)}
    json.dump(meta, open(od + '/meta.json', 'w'))
    return sid, meta

sel = [x for x in A if x['id'] in ids]
with cf.ThreadPoolExecutor(4) as ex:
    for sid, r in ex.map(lambda x: (lambda: one(x))() if True else None, sel):
        print(sid, r, flush=True)
idx = {}
for x in sel:
    p = os.path.join(OUT, x['id'], 'meta.json')
    if os.path.exists(p): idx[x['id']] = json.load(open(p))
json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
print('index', len(idx))
