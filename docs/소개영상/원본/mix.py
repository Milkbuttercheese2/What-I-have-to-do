"""음악(music.npy)을 영상 길이로 맞추고 내레이션·효과음을 얹어 final.wav를 쓴다. 말할 때 음악을 낮춘다."""
import json, subprocess, wave
import numpy as np
SR=44100
cues=json.load(open('cues.json')); T=cues['T']; TOTAL=cues['TOTAL']; N=int(TOTAL*SR)
music=np.load('music.npy').astype(np.float64)[:N]
if len(music)<N: raise SystemExit('음악이 영상보다 짧다')
def decode(path):
    raw=subprocess.run(['ffmpeg','-v','error','-i',path,'-f','s16le','-ac','1','-ar',str(SR),'-'],capture_output=True,check=True).stdout
    return np.frombuffer(raw,dtype=np.int16).astype(np.float64)/32768
voice=np.zeros(N); speech=np.zeros(N,dtype=bool)
for k,t in T.items():
    x=decode(f'tts/{k}.mp3')
    x=x/max(np.sqrt(np.mean(x[np.abs(x)>.01]**2)),1e-6)*.17  # 문장별 음량을 맞춘다
    i=int(t*SR); voice[i:i+len(x)]+=x[:N-i]; speech[i:i+len(x)]=True
# 말소리 구간 앞뒤로 여유를 두고 음악 음량 곡선을 부드럽게 만든다
def smooth(x,n):
    c=np.cumsum(np.concatenate([[0.],x])); i=np.arange(len(x))
    a=np.maximum(i-n//2,0); b=np.minimum(i+n//2+1,len(x))
    return (c[b]-c[a])/(b-a)
pad=int(.18*SR); env=smooth(speech.astype(float),2*pad+1)>0
gain=np.where(env,.11,.30); w=int(.25*SR); gain=smooth(gain,w)
gain[:w]=np.linspace(0,gain[w],w); tail=int(2.8*SR); gain[-tail:]*=np.linspace(1,0,tail)
mix=music*gain[:,None]
rng=np.random.default_rng(7)
def tick():
    n=int(.03*SR); t=np.arange(n)/SR
    return (np.sin(2*np.pi*2600*t)*.6+np.sin(2*np.pi*5200*t)*.25)*np.exp(-t/.005)
def swish():
    n=int(.2*SR); x=rng.standard_normal(n); x=np.convolve(x,np.ones(30)/30,'same')*5; t=np.arange(n)/SR
    return x*np.sin(np.pi*t/.2)**2
def place(sig,t,g):
    i=max(0,int(t*SR)-int(np.argmax(np.abs(sig)))); e=min(N,i+len(sig))
    for c in range(2): mix[i:e,c]+=sig[:e-i]*g
for t in cues['clicks']: place(tick(),t,.16)
for t in cues['morphs']: place(swish(),t,.05)
for c in range(2): mix[:,c]+=voice
peak=np.abs(mix).max(); mix=mix/max(1,peak/.95)
sp=speech; music_part=music.mean(axis=1)*gain
print('길이',round(N/SR,1),'피크',round(float(peak),3))
print('말소리 RMS',round(float(np.sqrt(np.mean(voice[sp]**2))),3),'같은 구간 음악 RMS',round(float(np.sqrt(np.mean(music_part[sp]**2))),3),
      '차이 dB',round(float(20*np.log10(np.sqrt(np.mean(voice[sp]**2))/np.sqrt(np.mean(music_part[sp]**2)))),1))
with wave.open('final.wav','wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((mix*32767).astype(np.int16).tobytes())
