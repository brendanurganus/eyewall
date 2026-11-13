# Summary of model vs NDBC buoys for the methodology page.
# usage: python3 tools/buoystats.py pairs_baseline.json pairs_calibrated.json anem.json cases.json out.json
# Wind: the model gives 1-min sustained wind at 10 m; NDBC buoys report 8-min means at the anemometer
# height (3.2-5 m, from NDBC station pages). Model converted to buoy terms: x0.93 (1-min to 10-min mean at
# sea, Harper, Kepert & Ginger 2010, WMO TD-1555) and a log profile with z0 = 0.002 m to the anemometer
# height. Years: odd = fitting set, even = held out.
import json, math, sys, collections
base, cal, anem, cases, out = sys.argv[1:6]
A = json.load(open(anem)); C = {(c['storm'], c['buoy']): c for c in json.load(open(cases))}
def stats(pairs):
    n = len(pairs)
    if not n: return None
    xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
    b = sum(y - x for x, y in pairs) / n; rm = math.sqrt(sum((y - x) ** 2 for x, y in pairs) / n)
    mx, my = sum(xs) / n, sum(ys) / n
    den = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys)) or 1
    return {'n': n, 'obs_mean': round(mx, 2), 'model_mean': round(my, 2), 'bias': round(b, 2), 'rmse': round(rm, 2), 'r': round(sum((x - mx) * (y - my) for x, y in pairs) / den, 2)}
def wconv(r):
    z = A.get(r['buoy']) or 4.1
    return r['m_ws'] * 0.93 * math.log(z / 0.002) / math.log(10 / 0.002)
res = {}
for lab, f in (('baseline', base), ('calibrated', cal)):
    R = json.load(open(f)); H = [r for r in R if r['o_hs'] is not None]
    d = {}
    for part, sel in (('all', lambda r: True), ('held_out', lambda r: int(r['storm'][4:]) % 2 == 0)):
        h = [r for r in H if sel(r)]
        d[part] = {'hs': stats([(r['o_hs'], r['m_hs']) for r in h]),
                   'hs_near_core': stats([(r['o_hs'], r['m_hs']) for r in h if r['r_km'] < 3 * r['rm_km']]),
                   'hs_far': stats([(r['o_hs'], r['m_hs']) for r in h if r['r_km'] >= 8 * r['rm_km']])}
        pk = collections.defaultdict(list)
        for r in h: pk[(r['storm'], r['buoy'])].append(r)
        P = [(max(x['o_hs'] for x in v), max(x['m_hs'] for x in v)) for v in pk.values() if len(v) >= 12 and min(x['r_km'] for x in v) < 150]
        d[part]['hs_peak_per_case'] = stats(P); d[part]['hs_peak_big'] = stats([p for p in P if p[0] >= 8])
    if lab == 'calibrated':
        d['tp'] = stats([(r['o_tp'], r['m_tp']) for r in R if r['o_tp'] is not None and r['r_km'] < 400])
        d['pressure'] = stats([(r['o_p'], r['m_p']) for r in R if r['o_p'] is not None and r['r_km'] < 300])
        d['wind_raw'] = stats([(r['o_ws'], r['m_ws']) for r in R if r['o_ws'] is not None and r['r_km'] < 300])
        d['wind'] = stats([(r['o_ws'], wconv(r)) for r in R if r['o_ws'] is not None and r['r_km'] < 300])
        d['wind_near_core'] = stats([(r['o_ws'], wconv(r)) for r in R if r['o_ws'] is not None and r['r_km'] < 3 * r['rm_km']])
        pk = collections.defaultdict(list)
        for r in R:
            if r['o_hs'] is not None: pk[(r['storm'], r['buoy'])].append(r)
        top = []
        for k, v in pk.items():
            if len(v) < 12 or min(x['r_km'] for x in v) >= 150: continue
            o = max(v, key=lambda x: x['o_hs']); m = max(v, key=lambda x: x['m_hs'])
            top.append({'storm': k[0], 'buoy': k[1], 'closest_km': round(min(x['r_km'] for x in v)), 'obs_peak': o['o_hs'], 'model_peak': round(m['m_hs'], 1), 'obs_tp': o['o_tp'], 'model_tp': round(m['m_tp'], 1)})
        d['largest_cases'] = sorted(top, key=lambda x: -x['obs_peak'])[:12]
        d['n_cases'] = len(C); d['n_buoys'] = len({k[1] for k in C}); d['n_storms'] = len({k[0] for k in C})
    res[lab] = d
json.dump(res, open(out, 'w'), indent=1)
print(json.dumps({k: {p: v[p] for p in ('all',) } for k, v in res.items()}, indent=0)[:1500])
c = res['calibrated']; print('tp', c['tp'], '\np', c['pressure'], '\nwind raw', c['wind_raw'], '\nwind', c['wind'], '\nwind core', c['wind_near_core'], '\ncases', c['n_cases'], c['n_buoys'], c['n_storms'])
