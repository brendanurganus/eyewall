import sys, gzip, glob, json, os, csv, math, collections
from datetime import datetime
ATL, PAC, BDIR, B26, OUT = sys.argv[1:6]
def num(s):
    s=s.strip()
    if s in ('','-999','-99'): return None
    return int(s)
def parse_h2(path):
    storms=[]; cur=None
    for line in open(path, encoding='ascii', errors='replace'):
        p=[x.strip() for x in line.rstrip('\n').split(',')]
        if len(p)<4: continue
        if p[0][:2] in ('AL','EP','CP') and len(p[0])==8 and p[0][2:].isdigit():
            cur={'id':p[0],'basin':p[0][:2],'num':int(p[0][2:4]),'year':int(p[0][4:]),'name':p[1],'n_decl':int(p[2]),'pts':[]}
            storms.append(cur); continue
        lat=float(p[4][:-1])*(1 if p[4][-1]=='N' else -1)
        lon=float(p[5][:-1])*(-1 if p[5][-1]=='W' else 1)
        r=[num(x) for x in p[8:20]]
        rmw=num(p[20]) if len(p)>20 else None
        cur['pts'].append({'t':p[0]+p[1],'rec':p[2] or None,'st':p[3],'lat':lat,'lon':lon,
            'vmax':num(p[6]) if num(p[6]) not in (None,) and num(p[6])>0 else None,'pmin':num(p[7]),
            'r34':r[0:4],'r50':r[4:8],'r64':r[8:12],'rmw_h2':rmw})
    return storms
def parse_b(path):
    op=gzip.open if path.endswith('.gz') else open
    rows={}
    with op(path,'rt',encoding='ascii',errors='replace') as f:
        for line in f:
            p=[x.strip() for x in line.split(',')]
            if len(p)<11 or p[4]!='BEST': continue
            dtg=p[2]; mm=p[3] if p[3].isdigit() else '00'
            key=dtg+mm.zfill(2)
            d=rows.setdefault(key,{})
            def g(i):
                try: v=int(p[i])
                except: return None
                return v
            la,lo=p[6],p[7]
            try:
                d['lat']=int(la[:-1])/10*(1 if la[-1]=='N' else -1); d['lon']=int(lo[:-1])/10*(-1 if lo[-1]=='W' else 1)
            except: pass
            d['vmax']=g(8); d['pmin']=g(9); d['ty']=p[10]
            rad=g(11)
            if rad in (34,50,64) and len(p)>16:
                code=p[12]; q=[g(13),g(14),g(15),g(16)]
                if code=='AAA': q=[q[0]]*4
                d['r%d'%rad]=q
            if len(p)>20:
                for nm,i in (('poci',17),('roci',18),('rmw',19),('gust',20),('eye',21)):
                    if len(p)>i:
                        v=g(i)
                        if v is not None and v>0: d[nm]=v
            if len(p)>27 and p[27]: d['name']=p[27]
    return rows
h2=parse_h2(ATL)+parse_h2(PAC)
h2=[s for s in h2 if s['year']>=2005]
bfiles={os.path.basename(f)[1:9].upper():f for f in glob.glob(BDIR+'/*.gz')}
miss_b=[]; mism=collections.Counter(); ex=[]
for s in h2:
    f=bfiles.get(s['id'])
    b=parse_b(f) if f else {}
    if not f: miss_b.append(s['id'])
    for pt in s['pts']:
        d=b.get(pt['t'])
        pt['src_struct']=None
        for k in ('rmw','eye','roci','poci','gust'): pt[k]=None
        if d:
            for k in ('rmw','eye','roci','poci','gust'): pt[k]=d.get(k)
            if d.get('vmax') is not None and pt['vmax'] is not None and d['vmax']!=pt['vmax']:
                mism['vmax']+=1
                if len(ex)<8: ex.append((s['id'],pt['t'],'vmax',pt['vmax'],d['vmax']))
            if d.get('pmin') and pt['pmin'] and d['pmin']!=pt['pmin']: mism['pmin']+=1
            if abs(d.get('lat',pt['lat'])-pt['lat'])>0.11 or abs(d.get('lon',pt['lon'])-pt['lon'])>0.11: mism['pos']+=1
            mism['matched']+=1
        else: mism['no_bdeck_row']+=1
        # final rmw: HURDAT2 (official, 2021+) preferred, else b-deck
        if pt['rmw_h2']: pt['rmw_final'],pt['rmw_src']=pt['rmw_h2'],'HURDAT2'
        elif pt['rmw']: pt['rmw_final'],pt['rmw_src']=pt['rmw'],'b-deck'
        else: pt['rmw_final'],pt['rmw_src']=None,None
# 2026 preliminary
prelim=[]
for f in sorted(glob.glob(B26+'/*.dat')):
    sid=os.path.basename(f)[1:9].upper(); b=parse_b(f)
    pts=[]; name=None
    for k in sorted(b):
        d=b[k]; name=d.get('name',name)
        if 'lat' not in d: continue
        pts.append({'t':k,'rec':None,'st':d.get('ty'),'lat':d['lat'],'lon':d['lon'],'vmax':d.get('vmax') or None,'pmin':d.get('pmin') or None,
          'r34':d.get('r34',[None]*4),'r50':d.get('r50',[None]*4),'r64':d.get('r64',[None]*4),'rmw_h2':None,
          'rmw':d.get('rmw'),'eye':d.get('eye'),'roci':d.get('roci'),'poci':d.get('poci'),'gust':d.get('gust'),
          'rmw_final':d.get('rmw'),'rmw_src':'b-deck (preliminary)' if d.get('rmw') else None})
    prelim.append({'id':sid,'basin':sid[:2],'num':int(sid[2:4]),'year':2026,'name':name,'pts':pts,'preliminary':True})
json.dump({'final':h2,'prelim':prelim},open(OUT+'/storms_raw.json','w'))
print('storms final',len(h2),'prelim',len(prelim)); print('missing bdeck files',miss_b); print('mismatch',dict(mism)); print(ex)
