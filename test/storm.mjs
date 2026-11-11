import K from '../src/katrina.js';
import {prepareTrack,stormAt,windAt,seaAt,sunPosition,precipAt,NM,KT} from '../src/storm.js';
const pts=prepareTrack(K);
const T=Date.UTC(2005,7,28,18);
const st=stormAt(pts,T);
console.log('cat',st.cat,'vmax',st.vmax.toFixed(1),'vsym',st.vsym.toFixed(1),'vt',st.vt.toFixed(1),'u,v',st.u.toFixed(1),st.v.toFixed(1),'bs',st.bs.toFixed(2),'hsMax',st.hsMax.toFixed(1),'tpMax',st.tpMax.toFixed(1),'fetch km',(st.fetch/1e3).toFixed(0));
for(const brg of [45,135,225,315]){ let row=[]; for(const rn of [5,10,20,30,50,90,125,200,300]){const r=rn*NM;const e=r*Math.sin(brg*Math.PI/180),n=r*Math.cos(brg*Math.PI/180);const w=windAt(st,e,n);const s=seaAt(st,e,n);row.push(`${rn}nm:${(w.speed/KT).toFixed(0)}kt/${s.hs.toFixed(0)}m`);} console.log(brg,row.join(' '),'| NOAA r64',K.pts.find(p=>p.t==='200508281800').r64,'r34',K.pts.find(p=>p.t==='200508281800').r34);}
let mx=0,at; for(let b=0;b<360;b+=5)for(let r=0.5;r<3;r+=0.05){const R=r*st.rm;const w=windAt(st,R*Math.sin(b*Math.PI/180),R*Math.cos(b*Math.PI/180)); if(w.speed>mx){mx=w.speed;at=[b,r,w.p/100,w.from]}} console.log('max wind kt',(mx/KT).toFixed(1),'at brg,r/rm,p,from',at);
console.log('center p',(windAt(st,0,100).p/100).toFixed(0));
const s=sunPosition(T,st.lat,st.lon); console.log('sun el',(s.el*180/Math.PI).toFixed(1),'az',(s.az*180/Math.PI).toFixed(1));
const s2=sunPosition(Date.UTC(2005,7,29,0,20),29.2,-89.6); console.log('sunset check (should be ~0 el near 00:20Z, az ~280):',(s2.el*180/Math.PI).toFixed(1),(s2.az*180/Math.PI).toFixed(1));
// buoy 42040 (29.212N 88.207W) Katrina time series
const bl=29.212, bo=-88.207;
for(const [d,h] of [[28,12],[28,18],[29,0],[29,6],[29,9],[29,11],[29,12],[29,15]]){const t=Date.UTC(2005,7,d,h);const q=stormAt(pts,t);const e=(bo-q.lon)*111320*Math.cos(q.lat*Math.PI/180),n=(bl-q.lat)*111320;const ss=seaAt(q,e,n);console.log(`42040 ${d}/${h}Z dist ${(Math.hypot(e,n)/1e3).toFixed(0)}km model Hs ${ss.hs.toFixed(1)} Tp ${ss.tp.toFixed(1)} wind ${(ss.wind.speed).toFixed(1)}m/s p ${(ss.wind.p/100).toFixed(0)}`)}
