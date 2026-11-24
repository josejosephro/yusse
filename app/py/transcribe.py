"""Transcribe un audio con faster-whisper y devuelve palabras con tiempos (JSON en stdout).
Progreso en stderr: 'PROGRESS 0.42'."""
import sys, json, argparse
p = argparse.ArgumentParser()
p.add_argument("audio"); p.add_argument("--model", default="small")
p.add_argument("--language", default=None); p.add_argument("--duration", type=float, default=0)
a = p.parse_args()
from faster_whisper import WhisperModel
m = WhisperModel(a.model, device="cpu", compute_type="int8")
segs, info = m.transcribe(a.audio, language=(a.language or None), word_timestamps=True, vad_filter=True)
dur = a.duration or info.duration or 1
words = []
for s in segs:
    for w in (s.words or []):
        t = w.word.strip()
        if t: words.append({"w": t, "s": round(w.start, 3), "e": round(w.end, 3)})
    sys.stderr.write("PROGRESS %.3f\n" % min(1, s.end / dur)); sys.stderr.flush()
print(json.dumps({"language": info.language, "words": words}, ensure_ascii=False))
