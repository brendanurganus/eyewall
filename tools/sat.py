import sys, numpy as np, json
from PIL import Image, ImageFilter
T, A, C, OUT = sys.argv[1:5]
LAT1, LON0, LAT0, LON1 = 34.3, -98.6, 18.3, -78.6          # top, left, bottom, right of the wide image
t = np.asarray(Image.open(T).convert('RGB')).astype(np.float32); a = np.asarray(Image.open(A).convert('RGB')).astype(np.float32)
H, W, _ = t.shape
gap = (t.sum(2) < 14).astype(np.float32)
gi = Image.fromarray((gap * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(6))
g = (np.asarray(gi).astype(np.float32) / 255)[..., None]
agap = (a.sum(2) < 14)
comp = t * (1 - g) + a * g
still = (comp.sum(2) < 14)
print('gap px %.1f%%' % (gap.mean() * 100), 'unfilled %.2f%%' % (still.mean() * 100))
img = Image.fromarray(comp.clip(0, 255).astype(np.uint8))
# eye: darkest spot of a blurred min-channel image near the best-track position at pass time
mn = np.asarray(img.filter(ImageFilter.GaussianBlur(5))).min(2).astype(np.float32)
px = lambda lon: (lon - LON0) / (LON1 - LON0) * W; py = lambda lat: (LAT1 - lat) / (LAT1 - LAT0) * H
cx, cy, R = int(px(-88.4)), int(py(26.2)), int(0.8 / (LON1 - LON0) * W)
sub = mn[cy - R:cy + R, cx - R:cx + R]; iy, ix = np.unravel_index(sub.argmin(), sub.shape)
ex, ey = cx - R + ix, cy - R + iy
elon, elat = LON0 + ex / W * (LON1 - LON0), LAT1 - ey / H * (LAT1 - LAT0)
print('eye px', ex, ey, 'lon/lat %.3f %.3f' % (elon, elat))
wide = img.resize((2048, 1638), Image.LANCZOS); wide.save(OUT + '/wide.jpg', quality=86)
cov = Image.fromarray(np.asarray(img).min(2)).filter(ImageFilter.GaussianBlur(7)).resize((640, 512), Image.LANCZOS); cov.save(OUT + '/cov.jpg', quality=82)
core = Image.open(C).convert('RGB').resize((1800, 1800), Image.LANCZOS); core.save(OUT + '/core.jpg', quality=88)
json.dump({'wide': [LON0, LAT1, LON1, LAT0], 'core': [-90.2, 28.1, -86.6, 24.5], 'eye': [round(float(elon), 4), round(float(elat), 4)]}, open(OUT + '/meta.json', 'w'))
img.resize((900, 720)).save('/tmp/wide_prev.jpg', quality=80)
