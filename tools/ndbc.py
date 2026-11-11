import sys,json,math,collections,re
ST,RAW=sys.argv[1:3]
F=json.load(open(RAW))['final']
st=[]
for line in open(ST,encoding='latin-1'):
    if line.startswith('#'): continue
    p=[x.strip() for x in line.split('|')]
    if len(p)<7: continue
    m=re.match(r'([\d.]+) ([NS]) ([\d.]+) ([EW])',p[6])
    if not m: continue
    la=float(m[1])*(1 if m[2]=='N' else -1); lo=float(m[3])*(-1 if m[4]=='W' else 1)
    st.append((p[0],p[1],p[2],p[3],la,lo))
print('stations',len(st),collections.Counter(s[1] for s in st).most_common(8))
print('types among owner N:',collections.Counter(s[2] for s in st if s[1]=='N').most_common(12))
nd=[s for s in st if s[1]=='N' and re.match(r'^\d{5}$',s[0]) and not s[0].startswith(('21','32','43','46','51','52','53','54','55','56','23','91')) or (s[1]=='N' and re.match(r'^(46|51)\d{3}$',s[0]))]
nd=[s for s in nd if 'DART' not in s[2].upper() and 'tsunami' not in s[2].lower()]
print('NDBC-owned numbered buoys (non-DART):',len(nd))
def hav(a,b,c,d):
    R=6371; p1,p2=math.radians(a),math.radians(c); dl=math.radians(d-b)
    x=math.sin((p2-p1)/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))
hit=collections.defaultdict(set); kat=[]
for s in F:
    for p in s['pts']:
        if (p['vmax'] or 0)<64: continue
        for b in nd:
            if abs(b[4]-p['lat'])>2: continue
            d=hav(p['lat'],p['lon'],b[4],b[5])
            if d<=150:
                hit[s['id']].add(b[0])
                if s['id']=='AL122005': kat.append((p['t'],b[0],round(d)))
print('hurricanes passing <=150 km of an NDBC-owned buoy location (at 6-h fixes, hurricane strength):',len(hit))
print(collections.Counter(k[:2] for k in hit))
print('Katrina:',kat)
