import json,sys,csv
RAW,EYES,OUT=sys.argv[1:4]
D=json.load(open(RAW)); E=json.load(open(EYES))
def cat(v):
    if v is None: return None
    return 'TD' if v<34 else 'TS' if v<64 else 1 if v<83 else 2 if v<96 else 3 if v<113 else 4 if v<137 else 5
rows=[]; storms=[]
for grp,pre in ((D['final'],False),(D['prelim'],True)):
    for s in grp:
        vm=max((p['vmax'] or 0) for p in s['pts']) if s['pts'] else 0
        storms.append({'id':s['id'],'basin':s['basin'],'year':s['year'],'name':s['name'],'preliminary':pre,'peak_kt':vm,'peak_cat':cat(vm),
            'min_mb':min((p['pmin'] for p in s['pts'] if p['pmin']),default=None),'start':s['pts'][0]['t'] if s['pts'] else None,'end':s['pts'][-1]['t'] if s['pts'] else None,
            'n_pts':len(s['pts']),'aircraft_eye_fixes':len(E.get(s['id'],[]))})
        for p in s['pts']:
            rows.append([s['id'],s['name'],p['t'],p['rec'] or '',p['st'],p['lat'],p['lon'],p['vmax'],p['pmin'],cat(p['vmax']),*p['r34'],*p['r50'],*p['r64'],p['rmw_final'],p['rmw_src'] or '',p.get('roci'),p.get('poci'),p.get('eye'),p.get('gust'),int(pre)])
hdr=['id','name','time_utc','record','status','lat','lon','vmax_kt','pmin_mb','cat','r34_ne','r34_se','r34_sw','r34_nw','r50_ne','r50_se','r50_sw','r50_nw','r64_ne','r64_se','r64_sw','r64_nw','rmw_nm','rmw_source','roci_nm','poci_mb','eye_diam_nm_bdeck','gust_kt','preliminary']
with open(OUT+'/eyewall_track_points.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(hdr); w.writerows([['' if x is None else x for x in r] for r in rows])
with open(OUT+'/eyewall_storms.csv','w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(storms[0])); w.writeheader(); w.writerows(storms)
print(len(storms),len(rows))
import collections
print(collections.Counter(str(s['peak_cat']) for s in storms if not s['preliminary']))
