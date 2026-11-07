"""시연영상 음악을 numpy로 합성한다. 120 BPM, 75마디(150초), 끝이 처음으로 이어지는 반복 재생.
외부 음원을 쓰지 않아 저작권 문제가 없다. 출력: music.wav, grid.json(박자 격자 측정값)."""
import json, sys, wave
import numpy as np

SR = 44100
BPM = 120
BEAT = 60 / BPM
BARS = 136
DUR = BARS * 4 * BEAT
N = int(DUR * SR)
rng = np.random.default_rng(2621)


def note_hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def env(n, a=0.004, d=0.2, s=0.0, r=0.05):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4))
    e = e * (s + (1 - s) * np.exp(-np.maximum(t - a, 0) / max(d, 1e-4)))
    tail = int(r * SR)
    if tail and n > tail:
        e[-tail:] *= np.linspace(1, 0, tail)
    return e


def add(bus, start, sig, gain=1.0):
    """시작 위치에 신호를 더한다. 끝을 넘친 부분은 처음으로 돌려 반복 이음새를 없앤다."""
    i = int(round(start * SR)) % N
    idx = (i + np.arange(len(sig))) % N
    np.add.at(bus, idx, sig * gain)


def kick():
    n = int(0.28 * SR)
    t = np.arange(n) / SR
    f = 46 + 95 * np.exp(-t / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.11)


def hat(open_=False):
    n = int((0.16 if open_ else 0.04) * SR)
    x = rng.standard_normal(n)
    x = np.diff(x, prepend=0)
    return x * np.exp(-np.arange(n) / SR / (0.05 if open_ else 0.012)) * 0.45


def clap():
    n = int(0.16 * SR)
    x = rng.standard_normal(n)
    x = x - np.convolve(x, np.ones(24) / 24, "same")
    t = np.arange(n) / SR
    e = np.exp(-t / 0.05) + 0.6 * np.exp(-np.maximum(t - 0.012, 0) / 0.02)
    return x * e * 0.5


def pluck(midi, dur=0.32, bright=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = note_hz(midi)
    mod = (1.6 * bright) * np.exp(-t / 0.07) * np.sin(2 * np.pi * f * 2 * t)
    return np.sin(2 * np.pi * f * t + mod) * env(n, 0.002, 0.13, 0.0, 0.02)


def pad(midis, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in midis:
        f = note_hz(m)
        for det in (-0.0018, 0.0018):
            out += np.sin(2 * np.pi * f * (1 + det) * t) + 0.22 * np.sin(2 * np.pi * 2 * f * (1 + det) * t)
    a = int(0.25 * SR)
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    e[-a:] = np.linspace(1, 0, a)
    return out * e / (2 * len(midis))


def bass(midi, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = note_hz(midi)
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * env(n, 0.004, 0.32, 0.25, 0.03)


# Am – F – C – G (A단조). 근음·패드·아르페지오
CHORDS = [
    (45, [57, 60, 64, 67]),
    (41, [57, 60, 65, 69]),
    (48, [55, 60, 64, 67]),
    (43, [55, 59, 62, 67]),
]
ARP = [0, 2, 1, 3, 2, 1, 3, 2]


def section(bar):
    """마디(0부터)별 악기 구성. 장면 격자와 같은 경계."""
    if bar < 14:
        return "intro"
    if bar < 38:
        return "groove"
    if bar < 62:
        return "main2"
    if bar < 75:
        return "break"
    return "intro"


drums = np.zeros(N)
bassbus = np.zeros(N)
padbus = np.zeros(N)
arpbus = np.zeros(N)
K, H, HO, C = kick(), hat(), hat(True), clap()

for bar in range(BARS):
    sec = section(bar)
    root, tones = CHORDS[(bar // 2) % 4] if sec != "break" else CHORDS[(bar // 4) % 4]
    t0 = bar * 4 * BEAT
    padbus_gain = {"intro": 0.5, "groove": 0.55, "main": 0.6, "lift": 0.75, "main2": 0.65, "break": 0.85}[sec]
    add(padbus, t0, pad(tones, 4 * BEAT + 0.2), padbus_gain)
    # 아르페지오: 8분음표
    arp_on = sec != "break" or bar % 2 == 0
    for i in range(8):
        if not arp_on:
            break
        if sec == "intro" and i % 2:
            continue
        m = tones[ARP[i]] + (12 if sec in ("lift", "main2") and i % 4 == 3 else 0)
        add(arpbus, t0 + i * BEAT / 2, pluck(m, bright=0.7 if sec == "break" else 1.0),
            0.55 if i % 2 == 0 else 0.38)
    if sec in ("groove", "main", "lift", "main2"):
        for b, step in ((0, 1.5), (1.5, 1), (2.5, 1.5)):
            add(bassbus, t0 + b * BEAT, bass(root, step * BEAT * 0.92), 0.85)
    # 드럼
    for b in range(4):
        tb = t0 + b * BEAT
        if sec != "break":
            add(drums, tb, K, 1.0 if sec != "intro" else 0.75)
        elif b == 0:
            add(drums, tb, K, 0.55)
        if sec in ("main", "main2", "lift", "groove") and b in (1, 3):
            add(drums, tb, C, 0.7 if sec != "groove" else 0.5)
        if sec != "intro" or bar % 2:
            add(drums, tb + BEAT / 2, HO if b == 3 and bar % 4 == 3 else H, 0.5)
        if sec in ("main", "main2", "lift"):
            add(drums, tb + BEAT / 4, H, 0.22)
            add(drums, tb + 3 * BEAT / 4, H, 0.26)

# 킥에 맞춘 사이드체인(주기 함수라 이음새가 없다)
phase = (np.arange(N) / SR) % BEAT
duck = 1 - 0.38 * np.exp(-phase / 0.09)


def echo(x, delay, fb):
    out = x.copy()
    d = int(delay * SR)
    for k in range(1, 5):
        out += np.roll(x, d * k) * fb ** k
    return out


arp_wet = echo(arpbus, BEAT * 0.75, 0.32)
L = 0.42 * drums + 0.8 * bassbus * duck + 0.42 * padbus * duck + 0.30 * arp_wet * duck
R = 0.42 * drums + 0.8 * bassbus * duck + 0.42 * padbus * duck + 0.30 * np.roll(arp_wet, int(0.011 * SR)) * duck

mix = np.stack([L, R], axis=1)
mix = np.tanh(mix * 1.15)
mix = mix / np.max(np.abs(mix)) * 0.86
np.save("music.npy", mix.astype(np.float32))

# 박자 격자 측정: 저역 에너지 피크를 예상 박자와 비교한다.
mono = mix.mean(axis=1)
low = np.convolve(mono, np.ones(220) / 220, "same")
energy = np.abs(low)
errs = []
for beat in range(0, int(DUR / BEAT)):
    if section(beat // 4) == "break":
        continue
    c = int(beat * BEAT * SR)
    a, b = max(0, c - 2205), min(N, c + 4410)
    peak = a + int(np.argmax(energy[a:b]))
    errs.append((peak - c) / SR * 1000)
errs = np.array(errs)
pcm = (mix * 32767).astype(np.int16)
with wave.open("music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
json.dump({"bpm": BPM, "beats": int(DUR / BEAT), "duration": DUR, "firstDownbeat": 0,
           "peakOffsetMsMedian": float(np.median(errs)), "peakOffsetMsP95": float(np.percentile(np.abs(errs), 95)),
           "seamDelta": float(np.abs(mix[0] - mix[-1]).max())}, open("grid.json", "w"), indent=1)
print(open("grid.json").read())
