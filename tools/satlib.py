# NASA true-colour snapshots for the storm archive (NASA Worldview Snapshots / GIBS; NASA open data).
# One snapshot per selected storm: the daytime pass on the day of peak intensity. 2016+ uses VIIRS
# (Suomi-NPP, ~13:30 local, no gaps between orbits); before that Terra MODIS (~10:30 local), with
# swath gaps filled from Aqua (~13:30). Eye registration as in tools/sat.py, but only accepted when the
# eye is clearly darker than the ring around it; otherwise the photo is placed by the NOAA position.
# usage: python3 tools/satlib.py src/archive.js outDir [ids...]   (default: all major hurricanes)
import sys, os, json, math, time, io, urllib.request, concurrent.futures as cf
import numpy as np
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

def one(x):
    sid = x['id']; od = os.path.join(OUT, sid)
    if os.path.exists(os.path.join(od, 'meta.json')) and sid not in REDO: return sid, 'cached'
    k = max(range(len(x['v'])), key=lambda i: x['v'][i]); tp = tOf(x['t'][k]); lat0, lon0 = x['lat'][k] / 10, x['lon'][k] / 10
    day = time.strftime('%Y-%m-%d', time.gmtime(tp + lon0 / 15 * 3600))          # local date at the storm
    viirs = x['year'] >= 2016          # VIIRS corrected reflectance in GIBS starts late 2015
    hloc = 13.5 if viirs else 10.5
    tpass = tOf(day.replace('-', '') + '0000') + (hloc - lon0 / 15) * 3600         # overpass, UTC (approx.)
    lat, lon = track_at(x, tpass)
    WB = [lon - 10, lat + 8, lon + 10, lat - 8]                                      # wide box: W, N, E, S
    CB = [lon - 1.8, lat + 1.8, lon + 1.8, lat - 1.8]
    if WB[0] < -180 or WB[2] > 180: return sid, 'skipped: crosses the dateline'
    q = lambda L, B, W, H: WVS.format(d=day, s=B[3], w=B[0], n=B[1], e=B[2], L=L, W=W, H=H)
    P = 'VIIRS_SNPP_CorrectedReflectance_TrueColor' if viirs else 'MODIS_Terra_CorrectedReflectance_TrueColor'
    t = np.asarray(fetch(q(P, WB, 1280, 1024))).astype(np.float32)
    if viirs and (t.sum(2) < 14).mean() > 0.3:                                       # no Suomi-NPP data: NOAA-20, then MODIS
        for alt in ('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'MODIS_Aqua_CorrectedReflectance_TrueColor'):
            ta = np.asarray(fetch(q(alt, WB, 1280, 1024))).astype(np.float32)
            if (ta.sum(2) < 14).mean() < 0.3: P, t = alt, ta; break
    gap = t.sum(2) < 14
    if not viirs and gap.mean() > 0.002:                                             # fill MODIS swath gaps from Aqua
        a = np.asarray(fetch(q('MODIS_Aqua_CorrectedReflectance_TrueColor', WB, 1280, 1024))).astype(np.float32)
        gi = Image.fromarray((gap * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(5))
        g = (np.asarray(gi).astype(np.float32) / 255)[..., None]; t = t * (1 - g) + a * g
    img = Image.fromarray(t.clip(0, 255).astype(np.uint8)); H, W = 1024, 1280
    still = (t.sum(2) < 14).mean()
    core = fetch(q(P, CB, 1400, 1400))
    cg = np.asarray(core).sum(2) < 14
    if not viirs and cg.mean() > 0.002:                                              # close-up swath gaps: Aqua too
        ca = np.asarray(fetch(q('MODIS_Aqua_CorrectedReflectance_TrueColor', CB, 1400, 1400))).astype(np.float32)
        gi = Image.fromarray((cg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(5))
        g = (np.asarray(gi).astype(np.float32) / 255)[..., None]
        core = Image.fromarray((np.asarray(core).astype(np.float32) * (1 - g) + ca * g).clip(0, 255).astype(np.uint8))
    # eye, found in the close-up (~0.3 km/px): darkest blurred min-channel spot within 0.6 deg of the NOAA
    # position, accepted only if clearly darker than the ring 15-35 km out; else placed by the NOAA position
    cm = np.asarray(core.filter(ImageFilter.GaussianBlur(4))).min(2).astype(np.float32); N = 1400; ppd = N / 3.6
    R = int(0.6 * ppd); c0 = N // 2; sub = cm[c0 - R:c0 + R, c0 - R:c0 + R]
    iy, ix = np.unravel_index(sub.argmin(), sub.shape); ex, ey = c0 - R + ix, c0 - R + iy
    yy, xx = np.mgrid[0:N, 0:N]; d = np.hypot(xx - ex, yy - ey) / ppd * 111
    rmask = (d > 15) & (d < 35); ring = float(np.median(cm[rmask])) if rmask.any() else 0.0
    eye = float(cm[ey, ex]); contrast = ring - eye       # darkest point, so pinhole eyes count too
    found = bool(contrast > 50 and ring > 140 and (np.asarray(core).sum(2) < 14).mean() < 0.05)
    elon, elat = (CB[0] + ex / N * 3.6, CB[1] - ey / N * 3.6) if found else (lon, lat)
    os.makedirs(od, exist_ok=True)
    img.save(od + '/wide.jpg', quality=82, optimize=True)
    Image.fromarray(np.asarray(img).min(2)).filter(ImageFilter.GaussianBlur(5)).resize((640, 512), Image.LANCZOS).save(od + '/cov.jpg', quality=80)
    core.save(od + '/core.jpg', quality=84, optimize=True)
    meta = {'t': int(tpass * 1000), 'src': {'VIIRS_NOAA20_CorrectedReflectance_TrueColor': 'VIIRS NOAA-20', 'MODIS_Aqua_CorrectedReflectance_TrueColor': 'MODIS Aqua'}.get(P) or ('VIIRS Suomi-NPP' if viirs else None) or 'MODIS Terra' + (' + Aqua' if not viirs and gap.mean() > 0.002 else ''),
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
