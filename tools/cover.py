import json,sys,collections,math,statistics as S
D=json.load(open(sys.argv[1])); F=D['final']; P=D['prelim']
print('header count mismatches:',[s['id'] for s in F if s['n_decl']!=len(s['pts'])])
by=collections.defaultdict(lambda: collections.Counter())
for s in F:
    by[s['basin']]['storms']+=1; by[s['basin']]['pts']+=len(s['pts'])
print({k:dict(v) for k,v in by.items()})
yrs=collections.defaultdict(lambda: collections.Counter())
for s in F: yrs[s['year']][s['basin']]+=1
print('storms/yr', {y:dict(c) for y,c in sorted(yrs.items())})
def pct(a,b): return f'{a}/{b} = {100*a/b:.1f}%' if b else 'n/a'
allp=[(s,p) for s in F for p in s['pts']]
print('points',len(allp))
print('vmax present',pct(sum(p['vmax'] is not None for s,p in allp),len(allp)))
print('pmin present',pct(sum(p['pmin'] is not None for s,p in allp),len(allp)))
ts=[(s,p) for s,p in allp if p['vmax'] and p['vmax']>=34]
print('TS+ pts',len(ts),'r34 any quadrant>0',pct(sum(any((x or 0)>0 for x in p['r34']) for s,p in ts),len(ts)))
print('TS+ r34 missing(-999)',sum(all(x is None for x in p['r34']) for s,p in ts))
hu=[(s,p) for s,p in allp if p['vmax'] and p['vmax']>=64]
print('HU pts',len(hu),'r64>0',pct(sum(any((x or 0)>0 for x in p['r64']) for s,p in hu),len(hu)))
trop=[(s,p) for s,p in allp if p['st'] in ('TD','TS','HU','SS','SD')]
print('tropical/subtropical pts',len(trop))
for nm,pts in (('all',allp),('TS+',ts),('HU',hu)):
    print(nm,'rmw_final',pct(sum(p['rmw_final'] is not None for s,p in pts),len(pts)),'| roci',pct(sum(p['roci'] is not None for s,p in pts),len(pts)),'| poci',pct(sum(p['poci'] is not None for s,p in pts),len(pts)),'| eye',pct(sum(p['eye'] is not None for s,p in pts),len(pts)))
print('rmw src',collections.Counter(p['rmw_src'] for s,p in allp))
print('--- by year: TS+ rmw%, HU eye%, MH(>=96) eye%')
for y in range(2005,2026):
    a=[p for s,p in ts if s['year']==y]; h=[p for s,p in hu if s['year']==y]; m=[p for p in h if p['vmax']>=96]
    print(y,len(a),f"rmw {100*sum(p['rmw_final'] is not None for p in a)/len(a):.0f}%",f"roci {100*sum(p['roci'] is not None for p in a)/len(a):.0f}%",f"| HU n={len(h)} eye {100*sum(p['eye'] is not None for p in h)/max(1,len(h)):.0f}%",f"| MH n={len(m)} eye {100*sum(p['eye'] is not None for p in m)/max(1,len(m)):.0f}%")
print('--- by basin TS+ rmw / HU eye')
for b in ('AL','EP','CP'):
    a=[p for s,p in ts if s['basin']==b]; h=[p for s,p in hu if s['basin']==b]
    print(b,pct(sum(p['rmw_final'] is not None for p in a),len(a)),pct(sum(p['eye'] is not None for p in h),len(h)))
# storms with no rmw at all while TS+
nor=[s['id']+' '+s['name'] for s in F if any(p['vmax'] and p['vmax']>=34 for p in s['pts']) and not any(p['rmw_final'] for p in s['pts'] if p['vmax'] and p['vmax']>=34)]
print('TS+ storms with zero rmw:',len(nor),nor[:40])
# suspicious values
print('rmw>150nm',sum(1 for s,p in allp if p['rmw_final'] and p['rmw_final']>150),'rmw<5',sum(1 for s,p in allp if p['rmw_final'] and p['rmw_final']<5))
print('eye>rmw*2',sum(1 for s,p in allp if p['rmw_final'] and p['eye'] and p['eye']>2*p['rmw_final']))
# time gaps
from datetime import datetime
gaps=collections.Counter(); big=[]
for s in F:
    t=[datetime.strptime(p['t'],'%Y%m%d%H%M') for p in s['pts']]
    for a,b in zip(t,t[1:]):
        h=(b-a).total_seconds()/3600; gaps['<=6h' if h<=6 else '6-12h' if h<=12 else '>12h']+=1
        if h>12: big.append((s['id'],s['name'],a.isoformat(),h))
        if h<=0: print('NONMONO',s['id'],a,b)
print('gaps',dict(gaps),big[:10])
print('date-line (lon>0 or < -180):',sorted({s['id']+' '+s['name'] for s,p in allp if p['lon']>0}))
print('status',collections.Counter(p['st'] for s,p in allp))
print('rec',collections.Counter(p['rec'] for s,p in allp))
# spot checks
def show(sid):
    s=[x for x in F if x['id']==sid][0]; pk=max(s['pts'],key=lambda p:(p['vmax'] or 0, -(p['pmin'] or 9999)))
    pm=min(s['pts'],key=lambda p:p['pmin'] or 9999)
    print(sid,s['name'],'peak',pk['t'],pk['vmax'],'kt',pk['pmin'],'mb','lat',pk['lat'],pk['lon'],'r34',pk['r34'],'r64',pk['r64'],'rmw',pk['rmw_final'],pk['rmw_src'],'eye',pk['eye'],'roci',pk['roci'],'poci',pk['poci'],'| minP',pm['t'],pm['pmin'])
for sid in ('AL122005','AL252005','EP202015','AL092017','AL052019','AL142018','AL142024','EP102014','AL182012'): show(sid)
k=[x for x in F if x['id']=='AL122005'][0]
for p in k['pts']: print(p['t'],p['rec'],p['st'],p['lat'],p['lon'],p['vmax'],p['pmin'],p['r34'],p['r64'],'rmw',p['rmw_final'],'eye',p['eye'],'roci',p['roci'],'poci',p['poci'])
print('PRELIM 2026:',[(s['id'],s['name'],len(s['pts']),max((p['vmax'] or 0) for p in s['pts'])) for s in P])
