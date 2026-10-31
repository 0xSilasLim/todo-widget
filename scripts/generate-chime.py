"""Bundle two original 600 ms chimes with a 150 ms silent gap using the stdlib."""
import math
from pathlib import Path
import struct
import wave

sample_rate = 44_100
duration = 0.6
gap = 0.15
samples = []
for index in range(round(sample_rate * duration)):
    time = index / sample_rate
    attack = 1 - math.exp(-time / 0.002)
    decay = math.exp(-time / 0.12)
    fade = min(1, (duration - time) / 0.04)
    tone = math.sin(math.tau * 1046.5 * time) + 0.2 * math.sin(math.tau * 2093 * time)
    samples.append(round(32767 * 0.22 * attack * decay * fade * tone))

samples = samples + [0] * round(sample_rate * gap) + samples
output = Path(__file__).resolve().parent.parent / 'src-tauri/assets/reminder.wav'
output.parent.mkdir(exist_ok=True)
with wave.open(str(output), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(sample_rate)
    audio.writeframes(struct.pack(f'<{len(samples)}h', *samples))
print(f'Generated {output}: two {duration}s chimes, {gap}s gap, mono PCM16, {sample_rate}Hz')
