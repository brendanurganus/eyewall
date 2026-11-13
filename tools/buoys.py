# Buoy cases for the wave/wind check: every archive hurricane fix (>= 64 kt) within 200 km of an
# NDBC-owned moored buoy (owner decision: NOAA-owned only), with that buoy's hourly standard
# meteorological record (NDBC historical stdmet, public domain) from 36 h before to 24 h after the
# closest approach. Buoy positions are NDBC's current ones (the historical files carry none).
# usage: python3 tools/buoys.py src/archive.js station_table.txt cachedir out.json
import json, sys, re, math, os, gzip, urllib.request, collections, datetime as dt

arch, table, cache, out = sys.argv[1:5]
s = open(arch).read(); A = json.loads(s[s.index('['):s.rindex(']') + 1])
st = []
for line in open(table, encoding='latin-1'):
    if line.startswith('#'): continue
    p = [x.strip() for x in line.split('|')]
    if len(p) < 7 or p[1] != 'N' or not re.match(r'^\d{5}$', p[0]): continue
    if 'tsunami' in (p[2] + p[4]).lower() or 'dart' in (p[2] + p[4]).lower(): continue
    m = re.match(r'([\d.]+) ([NS]) ([\d.]+) ([EW])', p[6])
    if m: st.append({'id': p[0], 'type': p[2], 'hull': p[3], 'name': p[4], 'lat': float(m[1]) * (1 if m[2] == 'N' else -1), 'lon': float(m[3]) * (-1 if m[4] == 'W' else 1)})

def km(a, b, c, d):
    p1, p2 = math.radians(a), math.radians(c); x = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(d - b) / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))
T = lambda k: dt.datetime.strptime(k, '%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc)

cases = {}
for S in A:
    for i, v in enumerate(S['v']):
        if (v or 0) < 64: continue
        la, lo = S['lat'][i] / 10, S['lon'][i] / 10
        for b in st:
            if abs(b['lat'] - la) > 2.5: continue
            d = km(la, lo, b['lat'], b['lon'])
            if d <= 200:
                k = (S['id'], b['id'])
                if k not in cases or d < cases[k]['d']: cases[k] = {'d': d, 't': S['t'][i], 'v': v}
print(len(cases), 'storm-buoy pairs', file=sys.stderr)

def stdmet(bid, year):
    f = os.path.join(cache, f'{bid}h{year}.txt.gz')
    if not os.path.exists(f):
        try:
            with urllib.request.urlopen(f'https://www.ndbc.noaa.gov/data/historical/stdmet/{bid}h{year}.txt.gz', timeout=60) as r: open(f, 'wb').write(r.read())
        except Exception as e:
            open(f + '.missing', 'w').write(str(e)); return None
    rows = {}
    for line in gzip.open(f, 'rt', errors='replace'):
        if line.startswith('#') or line[:4].strip().isalpha() or line.startswith('YY'): continue
        p = line.split()
        if len(p) < 13: continue
        y = int(p[0]); y = y + 1900 if y < 100 else y
        mm = int(p[4])
        t = dt.datetime(y, int(p[1]), int(p[2]), int(p[3]), mm, tzinfo=dt.timezone.utc)
        g = lambda j, bad: None if float(p[j]) >= bad else float(p[j])
        rows[t] = {'wdir': g(5, 999), 'wspd': g(6, 99), 'gst': g(7, 99), 'hs': g(8, 99), 'dpd': g(9, 99), 'pres': g(12, 9999)}
    return rows

res = []
for (sid, bid), c in sorted(cases.items()):
    if os.path.exists(os.path.join(cache, f'{bid}h{sid[4:]}.txt.gz.missing')): continue
    R = stdmet(bid, int(sid[4:]))
    if not R: continue
    t0 = T(c['t']); obs = []
    for t, r in sorted(R.items()):
        if t0 - dt.timedelta(hours=36) <= t <= t0 + dt.timedelta(hours=24) and t.minute in (0, 50):
            obs.append([int(t.timestamp() * 1000)] + [r[k] for k in ('wdir', 'wspd', 'gst', 'hs', 'dpd', 'pres')])
    nh = sum(1 for o in obs if o[4] is not None)
    b = next(x for x in st if x['id'] == bid)
    res.append({'storm': sid, 'buoy': bid, 'bname': b['name'], 'hull': b['hull'], 'lat': b['lat'], 'lon': b['lon'], 'closest_km': round(c['d']), 'closest_t': c['t'], 'vmax_then': c['v'], 'n_hs': nh, 'obs': obs})
json.dump(res, open(out, 'w'))
print(len(res), 'cases with data;', sum(1 for r in res if r['n_hs'] >= 12), 'with >= 12 wave obs', file=sys.stderr)
print(collections.Counter(r['storm'][:2] for r in res), file=sys.stderr)
