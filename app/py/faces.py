"""Devuelve la posicion horizontal media (0..1) de la cara principal en un tramo del video."""
import sys, json, cv2
path, start, end = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
cap = cv2.VideoCapture(path)
casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
xs = []
n = 12
for i in range(n):
    t = start + (end - start) * (i + 0.5) / n
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, fr = cap.read()
    if not ok: continue
    h, w = fr.shape[:2]
    g = cv2.cvtColor(cv2.resize(fr, (w * 360 // h, 360)), cv2.COLOR_BGR2GRAY)
    faces = casc.detectMultiScale(g, 1.1, 5, minSize=(30, 30))
    if len(faces):
        x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        xs.append((x + fw / 2) / g.shape[1])
xs.sort()
print(json.dumps({"x": xs[len(xs) // 2] if xs else 0.5, "found": len(xs)}))
