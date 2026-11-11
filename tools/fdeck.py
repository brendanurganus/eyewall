import sys,glob,gzip,os,json,collections
FD,RAW,OUT=sys.argv[1:4]
D=json.load(open(RAW)); F={s['id']:s for s in D['final']}
eyes={}; types=collections.Counter()
for f in glob.glob(FD+'/*.gz'):
    sid=os.path.basename(f)[1:9].upper(); L=[]
    try:
        for line in gzip.open(f,'rt',encoding='ascii',errors='replace'):
            p=[x.strip() for x in line.split(',')]
            if len(p)<50 or p[4]!='AIRC': continue
            for i in range(44,min(len(p)-2,56)):
                if p[i] in ('CI','EL','CO'):
                    d=p[i+2]
                    if d.isdigit() and 2<=int(d)<=120:
                        s2=p[i+3]; L.append({'t':p[2],'shape':p[i],'d':int(d),'d2':int(s2) if s2.isdigit() else None}); types[p[i]]+=1
                    break
    except Exception as e: print('ERR',f,e)
    if L: eyes[sid]=sorted(L,key=lambda x:x['t'])
json.dump(eyes,open(OUT+'/aircraft_eyes.json','w'))
hu=[s for s in F.values() if any((p['vmax'] or 0)>=64 for p in s['pts'])]
mh=[s for s in F.values() if any((p['vmax'] or 0)>=96 for p in s['pts'])]
print('storms w/ aircraft eye diameters',len(eyes),'total fixes',sum(len(v) for v in eyes.values()),dict(types))
for b in ('AL','EP','CP'):
    h=[s for s in hu if s['basin']==b]; m=[s for s in mh if s['basin']==b]
    print(b,'hurricanes',len(h),'with aircraft eye',sum(s['id'] in eyes for s in h),'| major',len(m),'with',sum(s['id'] in eyes for s in m))
k=eyes.get('AL122005',[]); print('Katrina fixes',len(k)); print([ (x['t'],x['shape'],x['d'],x['d2']) for x in k])
