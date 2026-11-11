import json,sys
D=json.load(open(sys.argv[1])); E=json.load(open(sys.argv[2]))
s=[x for x in D['final'] if x['id']=='AL122005'][0]
pts=[{k:p[k] for k in ('t','rec','st','lat','lon','vmax','pmin','r34','r50','r64','roci','poci')}|{'rmw':p['rmw_final']} for p in s['pts']]
out={'id':s['id'],'name':'Katrina','year':2005,'pts':pts,'eyes':[[e['t'],e['d'],e['d2'] or e['d']] for e in E.get('AL122005',[])]}
open(sys.argv[3],'w').write('export default '+json.dumps(out,separators=(',',':'))+';\n')
