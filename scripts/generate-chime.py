"""Generate the original, bundled 600 ms reminder chime using only the stdlib."""
import math
from pathlib import Path
import struct
import wave

sample_rate = 44_100
duration = 0.6
samples = []
for index in range(round(sample_rate * duration)):
    time = index / sample_rate
    attack = 1 - math.exp(-time / 0.002)
    decay = math.exp(-time / 0.12)
    fade = min(1, (duration - time) / 0.04)
    tone = math.sin(math.tau * 1046.5 * time) + 0.2 * math.sin(math.tau * 2093 * time)
    samples.append(round(32767 * 0.22 * attack * decay * fade * tone))

output = Path(__file__).resolve().parent.parent / 'src-tauri/assets/reminder.wav'
output.parent.mkdir(exist_ok=True)
with wave.open(str(output), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(sample_rate)
    audio.writeframes(struct.pack(f'<{len(samples)}h', *samples))
print(f'Generated {output}: {duration}s, mono PCM16, {sample_rate}Hz')
