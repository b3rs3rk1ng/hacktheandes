"""Original instrumental score and film sound design. No samples or vocals."""
from pathlib import Path
import numpy as np
import wave,os
SR=48000;D=72;N=SR*D;rng=np.random.default_rng(37)
left=np.zeros(N,np.float32);right=np.zeros(N,np.float32)
def add(signal,start,gain=1,pan=0):
 i=int(start*SR);j=min(N,i+len(signal));a=max(0,-i)
 if j<=max(0,i):return
 s=signal[a:a+j-max(0,i)]*gain;left[max(0,i):j]+=s*np.sqrt((1-pan)/2);right[max(0,i):j]+=s*np.sqrt((1+pan)/2)
def hz(m):return 440*2**((m-69)/12)
def note(m,d,kind='pad'):
 t=np.arange(int(d*SR))/SR;f=hz(m)
 if kind=='pad':
  s=(np.sin(2*np.pi*f*t+.2*np.sin(t*.8))+ .40*np.sin(2*np.pi*f*1.003*t)+.22*np.sin(2*np.pi*f*2*t)+.07*np.sin(2*np.pi*f*3*t))
  env=np.minimum(1,t/1.7)*np.minimum(1,(d-t)/2.4)
 elif kind=='pluck':
  s=np.sin(2*np.pi*f*t)*np.exp(-t*3.5)+.3*np.sin(2*np.pi*f*2.003*t)*np.exp(-t*7)+.13*np.sin(2*np.pi*f*3.997*t)*np.exp(-t*10)
  env=np.minimum(1,t/.009)
 else:s=np.sin(2*np.pi*f*t)+.13*np.sin(2*np.pi*f*2*t);env=np.minimum(1,t/.035)*np.minimum(1,(d-t)/.14)
 return (s*env).astype(np.float32)
# D minor / Bb / F / C; an original sparse melodic line grows into the finale.
chords=[[50,57,62,65],[46,53,58,62],[41,53,57,60],[48,55,60,64]]
for start in np.arange(0,72,4.8):
 chord=chords[int(start/4.8)%4];gain=.055 if start<14 else .07 if start<59 else .10
 for k,m in enumerate(chord):add(note(m,7.1),start,gain,(-.65+k*.43))
 add(note(chord[0]-12,5.8,'bass'),start,.065)
# Rhythmic synth ostinato, quiet until deployment.
pattern=[74,69,77,69,72,69,65,69]
for k,start in enumerate(np.arange(8.4,59,.6)):
 gain=.028 if start<21 else .06
 add(note(pattern[k%8],1.8,'pluck'),start,gain,np.sin(k*1.7)*.55)
 for delay,g in [(0.3,.27),(.6,.13)]:add(note(pattern[k%8],1.8,'pluck'),start+delay,gain*g,-np.sin(k*1.7)*.55)
# Final melody, broad rather than frantic.
for start,m,d in [(63,74,1.3),(64.2,77,1.8),(66,81,2.1),(68.1,79,.9),(69,77,3)]:
 add(note(m,d+1.1,'pad'),start,.12,-.05)
 add(note(m+12,d+.8,'pluck'),start,.075,.25)
def kick():
 t=np.arange(int(.5*SR))/SR;phase=2*np.pi*(43*t+(100-43)*.035*(1-np.exp(-t/.035)));return np.sin(phase)*np.exp(-t*11)+rng.normal(0,.08,len(t))*np.exp(-t*80)
def hat():
 t=np.arange(int(.13*SR))/SR;n=rng.normal(0,1,len(t));n[1:]-=.85*n[:-1];return n*np.exp(-t*47)
for k,start in enumerate(np.arange(21,58.9,.6)):
 if 36.8<start<38:continue
 add(kick(),start,.15 if k%4==0 else .085)
 add(hat(),start+.3,.026,(-1 if k%2 else 1)*.5)
 if k%4==2:
  t=np.arange(int(.25*SR))/SR;sn=rng.normal(0,1,len(t))*np.exp(-t*25)+.3*np.sin(2*np.pi*185*t)*np.exp(-t*22);add(sn,start,.035,.15)
# Air sweeps and low impacts accompany the actual chapter cuts.
for start in [3,9,14,21,26,31,39,46,52,59,63]:
 t=np.arange(int(1.25*SR))/SR;n=rng.normal(0,1,len(t));n=np.convolve(n,np.ones(30)/30,mode='same');env=np.sin(np.pi*t/1.25)**2
 add(n*env,start-.55,.13,.1)
 add(note(26,1.8,'bass')*np.exp(-np.arange(int(1.8*SR))/SR*2.5),start,.19)
# Field air and rotor movement: designed, not claimed as a field recording.
t=np.arange(N)/SR
noise=rng.normal(0,1,N).astype(np.float32);air=np.convolve(noise,np.ones(96)/96,mode='same')
add(air,0,.095)
rotor=(np.sin(2*np.pi*112*t+3*np.sin(2*np.pi*1.1*t))+.22*np.sin(2*np.pi*227*t))*(.7+.3*np.sin(2*np.pi*18*t))
renv=np.interp(t,[0,1.2,3,8,13,18,50,58,62,63,65,72],[0,.0,.045,.055,.025,.012,.012,.025,0,0,.025,0]);add((rotor*renv).astype(np.float32),0,1,-.18)
# Metallic tool closures, with a short musical breath at the cut.
for start in [34.3,36.6,42.8]:
 tt=np.arange(int(.32*SR))/SR;s=(np.sin(2*np.pi*1350*tt)+.6*np.sin(2*np.pi*2130*tt))*np.exp(-tt*32);add(s,start,.09,.2)
# A warm ascending harmony supports the raised flag and farewell.
for start,chord in [(62.5,[53,57,60,65]),(65,[58,62,65,69]),(67.5,[53,60,65,69])]:
 for k,m in enumerate(chord):add(note(m,4.5),start,.055,(-.6+k*.4))
for start in [63,65.4,67.8]:add(kick(),start,.10)
for a in (left,right):
 dry=a.copy()
 for delay,g in [(.137,.10),(.283,.13),(.419,.08),(.691,.055)]:
  n=int(delay*SR);a[n:]+=dry[:-n]*g
fade=np.minimum(1,t/2)*np.minimum(1,(72-t)/2.7)
# Briefly duck the score at the cutting gesture.
duck=1-.60*np.exp(-((t-36.6)/.23)**2)
audio=np.stack([left,right],axis=1)*fade[:,None]*duck[:,None]
audio=np.tanh(audio*1.15);audio*=.87/max(.87,np.max(np.abs(audio)))
out=Path(os.environ.get('FILM_OUTPUT',Path(__file__).resolve().parents[2]/'output/video/cacao-v3'))/'score-original.wav'
with wave.open(str(out),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((audio*32767).astype('<i2').tobytes())
print(out)
