# Live storms for Eyewall: NOAA NHC / CPHC current data -> live.json (public domain, US federal).
#
#   python3 tools/live.py OUT.json [--prev PREV.json]            live: whatever NHC lists right now
#   python3 tools/live.py OUT.json --demo al092026 010           replay one archived advisory (labelled demo)
#
# Sources, all from www.nhc.noaa.gov / ftp.nhc.noaa.gov (CPHC storms are carried in the same feeds):
#   CurrentStorms.json            which storms are active, latest advisory number, position, links
#   atcf/btk/b<id>.dat            ATCF best track so far (6-hourly fixes, wind radii, RMW): the same fields
#                                 the archive uses, so the dive runs on it unchanged. Operational, not final.
#   gis/forecast/archive/<id>_5day_<adv>.zip   forecast points and the cone of uncertainty (shapefiles)
# Standard library only, so the scheduled refresh needs nothing installed.
# Prints PUBLISH or SKIP as its last line: PUBLISH when the storms or advisories changed since PREV, or
# PREV is more than 20 hours old (a daily heartbeat, so the page can say when it was last checked).
import json, sys, io, struct, zipfile, urllib.request, datetime as dt

UA = {'User-Agent': 'Eyewall hurricane visualiser (public-domain NOAA data)'}
CUR = 'https://www.nhc.noaa.gov/CurrentStorms.json'
BTK = 'https://ftp.nhc.noaa.gov/atcf/btk/b{}.dat'
ZIP = 'https://www.nhc.noaa.gov/gis/forecast/archive/{}_5day_{}.zip'

def get(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: return r.read()
        except Exception as e:
            if k == tries - 1: raise
            print('retry', url, e, file=sys.stderr)

def num(s):
    try: return int(round(float(s)))
    except: return None

# ---- ATCF b-deck: one row per fix and wind threshold ----
def parse_b(text):
    rows = {}
    for line in text.splitlines():
        p = [x.strip() for x in line.split(',')]
        if len(p) < 11 or p[4] != 'BEST': continue
        key = p[2] + (p[3].zfill(2) if p[3].isdigit() else '00')
        d = rows.setdefault(key, {})
        try:
            d['lat'] = int(p[6][:-1]) / 10 * (1 if p[6][-1] == 'N' else -1)
            d['lon'] = int(p[7][:-1]) / 10 * (-1 if p[7][-1] == 'W' else 1)
        except: continue
        d['vmax'] = num(p[8]); d['pmin'] = num(p[9]); d['ty'] = p[10]
        rad = num(p[11]) if len(p) > 11 else None
        if rad in (34, 50, 64) and len(p) > 16:
            q = [num(p[i]) for i in (13, 14, 15, 16)]
            if p[12] == 'AAA': q = [q[0]] * 4
            d['r%d' % rad] = q
        for nm, i in (('poci', 17), ('roci', 18), ('rmw', 19)):
            v = num(p[i]) if len(p) > i else None
            if v and v > 0: d[nm] = v
        if len(p) > 27 and p[27]: d['name'] = p[27]
    return rows

# ---- shapefiles (points and polygons) from the forecast zip ----
def dbf(b):
    n, hl, rl = struct.unpack('<IHH', b[4:12]); f = []; o = 32
    while b[o] != 0x0D: f.append((b[o:o + 11].split(b'\0')[0].decode(), b[o + 16])); o += 32
    out = []
    for r in range(n):
        o = hl + r * rl + 1; row = {}
        for name, ln in f: row[name] = b[o:o + ln].decode('latin-1').strip(); o += ln
        out.append(row)
    return out

def shp(b):
    o = 100; out = []
    while o < len(b):
        ln = struct.unpack('>I', b[o + 4:o + 8])[0] * 2; c = b[o + 8:o + 8 + ln]; o += 8 + ln
        t = struct.unpack('<i', c[:4])[0]
        if t == 1: out.append([struct.unpack('<2d', c[4:20])])
        elif t in (3, 5):
            np_, nq = struct.unpack('<2i', c[36:44]); parts = list(struct.unpack('<%di' % np_, c[44:44 + 4 * np_]))
            pts = struct.unpack('<%dd' % (2 * nq), c[44 + 4 * np_:44 + 4 * np_ + 16 * nq])
            xy = [(pts[2 * i], pts[2 * i + 1]) for i in range(nq)]
            out.append([xy[a:b_] for a, b_ in zip(parts, parts[1:] + [nq])])
        else: out.append(None)
    return out

def forecast(sid, adv):
    z = zipfile.ZipFile(io.BytesIO(get(ZIP.format(sid, adv))))
    nm = lambda suf: next(n for n in z.namelist() if n.endswith(suf))
    pts = dbf(z.read(nm('_5day_pts.dbf')))
    fc = []
    for r in pts:
        g = lambda *ks: next((r[k] for k in ks if r.get(k)), '')
        fc.append({'tau': num(g('TAU', 'FCSTPRD')), 'lat': float(g('LAT')), 'lon': float(g('LON')),
                   'v': num(g('MAXWIND')), 'g': num(g('GUST')), 'p': num(g('MSLP')) if num(g('MSLP')) and num(g('MSLP')) < 1100 else None,
                   'ty': g('TCDVLP', 'STORMTYPE'), 'lbl': g('DATELBL'), 'adv': g('ADVDATE')})
    cone = []
    try:
        for parts in shp(z.read(nm('_5day_pgn.shp'))):
            if parts: cone = max(parts, key=len)          # outer ring
    except StopIteration: pass
    # keep the outline light: ~0.05 degree steps, at most ~400 points
    step = max(1, len(cone) // 400)
    cone = [[round(x, 2), round(y, 2)] for x, y in cone[::step]]
    return fc, cone

def title(n): return ' '.join(w.capitalize() for w in n.split(' ')) if n else n
def cat(kt): return 'TD' if kt < 34 else 'TS' if kt < 64 else '1' if kt < 83 else '2' if kt < 96 else '3' if kt < 113 else '4' if kt < 137 else '5'

def entry(a, cutoff=None):
    sid = a['id'].lower()
    try: B = parse_b(get(BTK.format(sid)).decode('ascii', 'replace'))
    except Exception as e: print('no b-deck for', sid, e, file=sys.stderr); B = {}
    keys = sorted(k for k in B if 'lat' in B[k] and (cutoff is None or k <= cutoff))
    P = [B[k] for k in keys]
    adv = a['forecastAdvisory']['advNum'] if a.get('forecastAdvisory') else None
    fc, cone = ([], [])
    if adv:
        try: fc, cone = forecast(sid, adv)
        except Exception as e: print('no forecast GIS for', sid, adv, e, file=sys.stderr)
    V = [p.get('vmax') or 0 for p in P]
    peak = max(V + [num(a['intensity']) or 0])                         # strongest so far, advisory included
    res = {'id': a['id'].upper(), 'name': title(a['name']), 'basin': a['id'][:2].upper(), 'year': int(a['id'][4:8]),
           'peak': peak, 'cat': cat(peak), 'pmin': min((p['pmin'] for p in P if p.get('pmin')), default=None),
           't': keys, 'rec': ['' for _ in P], 'st': [p.get('ty') for p in P],
           'lat': [round(p['lat'] * 10) for p in P], 'lon': [round(p['lon'] * 10) for p in P],
           'v': [p.get('vmax') for p in P], 'p': [p.get('pmin') for p in P],
           'r34': [p.get('r34', [None] * 4) for p in P], 'r50': [p.get('r50', [None] * 4) for p in P], 'r64': [p.get('r64', [None] * 4) for p in P],
           'rmw': [p.get('rmw') for p in P], 'poci': [p.get('poci') for p in P], 'roci': [p.get('roci') for p in P], 'eyes': [],
           'live': {'adv': adv, 'issued': a['forecastAdvisory']['issuance'] if adv else a.get('lastUpdate'), 'cls': a['classification'],
                    'v': num(a['intensity']), 'p': num(a['pressure']), 'lat': a['latitudeNumeric'], 'lon': a['longitudeNumeric'],
                    'dir': a.get('movementDir'), 'spd': a.get('movementSpeed'), 'bin': a.get('binNumber'),
                    'pub': (a.get('publicAdvisory') or {}).get('url'), 'gfx': (a.get('forecastGraphics') or {}).get('url'),
                    'disc': (a.get('forecastDiscussion') or {}).get('url'), 'fc': fc, 'cone': cone}}
    return res

def demo(sid, adv):
    # rebuild the CurrentStorms.json entry from the archived advisory's own forecast file
    z = zipfile.ZipFile(io.BytesIO(get(ZIP.format(sid, adv))))
    r0 = dbf(z.read(next(n for n in z.namelist() if n.endswith('_5day_pts.dbf'))))[0]
    B = parse_b(get(BTK.format(sid)).decode('ascii', 'replace'))
    lat, lon = float(r0['LAT']), float(r0['LON'])
    vd, vh = r0['VALIDTIME'].split('/')                                  # synoptic time of the advisory, DD/HHMM
    k0 = next(k for k in sorted(B) if k[6:8] == vd and k[8:12] == vh)   # the best-track fix it was issued for
    name = r0['STORMNAME'].split(' ')[-1]
    t0 = dt.datetime.strptime(k0[:10], '%Y%m%d%H').replace(tzinfo=dt.timezone.utc)
    iso = (t0 + dt.timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    a = {'id': sid, 'name': name, 'classification': {'MH': 'HU', 'DB': 'TD', 'LO': 'TD'}.get(r0['STORMTYPE'], r0['STORMTYPE']),
         'intensity': r0['MAXWIND'], 'pressure': r0['MSLP'], 'latitudeNumeric': lat, 'longitudeNumeric': lon,
         'movementDir': num(r0.get('TCDIR')), 'movementSpeed': num(r0.get('TCSPD')), 'lastUpdate': iso, 'binNumber': None,
         'forecastAdvisory': {'advNum': adv, 'issuance': iso}}
    yr, nn = sid[4:8], sid[:4]
    a['publicAdvisory'] = {'url': f'https://www.nhc.noaa.gov/archive/{yr}/{nn}/{sid}.public.{adv}.shtml'}
    a['forecastDiscussion'] = {'url': f'https://www.nhc.noaa.gov/archive/{yr}/{nn}/{sid}.discus.{adv}.shtml'}
    a['forecastGraphics'] = {'url': f'https://www.nhc.noaa.gov/archive/{yr}/{name.upper()}_graphics.php'}
    e = entry(a, cutoff=k0)
    e['live']['demo'] = f'Replay of NHC advisory {int(adv)} for {title(name)} ({iso[:10]}). Not a live storm.'
    return e

def main():
    args = sys.argv[1:]; out = args[0]
    now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    if '--demo' in args:
        i = args.index('--demo'); storms = [demo(args[i + 1].lower(), args[i + 2])]
    else:
        cs = json.loads(get(CUR)); storms = [entry(a) for a in cs.get('activeStorms', [])]
    doc = {'checked': now, 'source': 'NOAA National Hurricane Center / Central Pacific Hurricane Center', 'storms': storms}
    open(out, 'w').write(json.dumps(doc, separators=(',', ':')))
    for s in storms: print(s['id'], s['name'], s['live']['cls'], s['live']['v'], 'kt adv', s['live']['adv'], len(s['t']), 'fixes', len(s['live']['fc']), 'fc pts', len(s['live']['cone']), 'cone pts', file=sys.stderr)
    print(len(storms), 'active', file=sys.stderr)
    pub = True
    if '--prev' in args:
        try:
            prev = json.load(open(args[args.index('--prev') + 1]))
            same = [(s['id'], s['live']['adv'], s['t'][-1:]) for s in prev['storms']] == [(s['id'], s['live']['adv'], s['t'][-1:]) for s in storms]
            age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.strptime(prev['checked'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)).total_seconds() / 3600
            pub = not same or age > 20
        except Exception as e: print('prev unreadable, publishing:', e, file=sys.stderr)
    print('PUBLISH' if pub else 'SKIP')

if __name__ == '__main__': main()
