import { CascadeCPU, spectrumAlpha } from '../src/fft.js';
const cfg=[{N:128,L:4000},{N:256,L:500},{N:256,L:57}];
const kc=cfg.map(c=>0.95*Math.PI*c.N/c.L), kLo0=2*Math.PI/cfg[0].L*0.99;
for (const [hs,tp] of [[22,17.8],[22,15],[14,13],[5,9]]) {
  const c=new CascadeCPU(128,4000,12345);
  const P={wp:2*Math.PI/tp,gamma:2.6,smax:9,iso:0.2,th:0.3,delta:1.2,kLo:kLo0,kHi:kc[0]};
  P.alpha=spectrumAlpha(hs,tp,P.gamma,kLo0,kc[2]); c.setSpectrum(P);
  let v=0,n=0,mx=0; for (const t of [0,37,91,160,233]) { c.update(t); for (let i=0;i<128*128;i++){const h=c.out[i*4]; v+=h*h; n++; mx=Math.max(mx,Math.abs(h));} }
  const a0=spectrumAlpha(hs,tp,P.gamma,kLo0,kc[0]);
  console.log(`target Hs ${hs} Tp ${tp}: cascade0 Hs ${(4*Math.sqrt(v/n)).toFixed(2)} (expected share ${(hs*Math.sqrt(P.alpha/a0)).toFixed(2)}), max |h| ${mx.toFixed(1)}`);
}
