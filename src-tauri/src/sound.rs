use std::{ffi::c_void, ptr};

const CHIME: &[u8] = include_bytes!("../assets/reminder.wav");
const SND_ASYNC: u32 = 0x0001;
const SND_NODEFAULT: u32 = 0x0002;
const SND_MEMORY: u32 = 0x0004;

#[link(name = "winmm")]
unsafe extern "system" {
    fn PlaySoundW(sound: *const u16, module: *mut c_void, flags: u32) -> i32;
}

pub(crate) fn play() -> Result<(), String> {
    // SAFETY: SND_MEMORY interprets the pointer as a WAV buffer, not UTF-16.
    // The embedded immutable buffer lives for the entire asynchronous playback.
    // This uses ordinary app audio, independently of Windows toast settings.
    let started = unsafe {
        PlaySoundW(
            CHIME.as_ptr().cast(),
            ptr::null_mut(),
            SND_ASYNC | SND_MEMORY | SND_NODEFAULT,
        )
    };
    if started == 0 {
        return Err("无法播放提醒提示音，请检查音频设备是否可用。".into());
    }
    #[cfg(debug_assertions)]
    eprintln!("[reminder-audio] started");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_chime_is_short_pcm_audio_with_a_soft_attack_and_decay() {
        let u16_at = |offset| u16::from_le_bytes(CHIME[offset..offset + 2].try_into().unwrap());
        let u32_at = |offset| u32::from_le_bytes(CHIME[offset..offset + 4].try_into().unwrap());
        assert_eq!(&CHIME[..4], b"RIFF");
        assert_eq!(&CHIME[8..16], b"WAVEfmt ");
        assert_eq!(u32_at(4) as usize + 8, CHIME.len());
        assert_eq!(u32_at(16), 16);
        assert_eq!(u16_at(20), 1); // PCM
        assert_eq!(u16_at(22), 1); // Mono
        assert_eq!(u32_at(24), 44_100);
        assert_eq!(u16_at(32), 2);
        assert_eq!(u16_at(34), 16);
        assert_eq!(&CHIME[36..40], b"data");
        assert_eq!(u32_at(40) as usize, CHIME.len() - 44);
        let duration = f64::from(u32_at(40)) / f64::from(u32_at(28));
        assert!((0.3..=0.8).contains(&duration));
        let samples: Vec<_> = CHIME[44..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|bytes| i16::from_le_bytes(*bytes))
            .collect();
        let peak = samples
            .iter()
            .map(|value| value.unsigned_abs())
            .max()
            .unwrap();
        assert!((1000..16000).contains(&peak));
        assert_eq!(samples[0], 0);
        assert!(samples[samples.len() - 200..]
            .iter()
            .all(|value| value.unsigned_abs() < 100));
    }

    #[test]
    #[ignore = "Audible diagnostic: requires a Windows audio device"]
    fn plays_a_short_chime() {
        play().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(800));
    }
}
