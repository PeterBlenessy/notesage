//! Streaming 16-bit PCM WAV writer, header repair, and a streaming reader.
//!
//! The writer is built so that a recording survives the things that happen to
//! hour-long recordings: the header can be patched at any time (a crash then
//! costs at most the seconds since the last patch, and even those are
//! recoverable from the file length), a failed write is reported once and the
//! count of samples that actually reached the file stays truthful, and the
//! 4 GiB RIFF limit is refused rather than wrapped.
//!
//! Pure `std`: no audio stack, no Tauri. Everything here runs in unit tests.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

/// Size of the canonical PCM header this module writes.
pub const WAV_HEADER_LEN: u64 = 44;

/// Largest `data` chunk a RIFF file can describe (`riff_size = 36 + data`
/// must fit a `u32`), rounded down so any block alignment divides it.
pub const MAX_DATA_BYTES: u64 = 0xFFFF_F000;

/// Buffered bytes are handed to the file once this many have accumulated.
const FLUSH_THRESHOLD: usize = 64 * 1024;

/// Error text of the size guard. Matched by the capture loop to tell "file is
/// full" from an I/O failure.
pub const WAV_FULL: &str = "WAV size limit reached";

/// What a WAV writer writes into. `sync` asks the OS to persist the data; the
/// default is a no-op so in-memory sinks used in tests need not care.
pub trait WavSink: Write + Seek {
    fn sync(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl WavSink for File {
    fn sync(&mut self) -> std::io::Result<()> {
        self.sync_data()
    }
}

impl WavSink for std::io::Cursor<Vec<u8>> {}

/// Build a 44-byte canonical WAV header for 16-bit PCM.
pub fn wav_header(sample_rate: u32, channels: u16, data_bytes: u32) -> [u8; 44] {
    let bits_per_sample: u16 = 16;
    let block_align = channels.saturating_mul(bits_per_sample / 8);
    let byte_rate = sample_rate.saturating_mul(block_align as u32);
    let riff_size = 36u32.saturating_add(data_bytes);

    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&riff_size.to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    h[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    h[32..34].copy_from_slice(&block_align.to_le_bytes());
    h[34..36].copy_from_slice(&bits_per_sample.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    h
}

/// Convert one float sample to 16-bit PCM, clamping to [-1, 1].
#[inline]
pub fn f32_to_i16(s: f32) -> i16 {
    (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

/// Recorded duration from an interleaved sample count.
pub fn duration_from_samples(samples: u64, sample_rate: u32, channels: u16) -> f64 {
    let per_second = sample_rate as u64 * channels.max(1) as u64;
    if per_second == 0 {
        return 0.0;
    }
    samples as f64 / per_second as f64
}

/// Open `path` for writing, owner read/write only (S5). Truncates.
pub fn create_private_file(path: &Path) -> std::io::Result<File> {
    let mut opts = std::fs::OpenOptions::new();
    opts.read(true).write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)
}

/// Streaming WAV writer for 16-bit PCM.
///
/// `bytes_committed` counts only data bytes a `write_all` on the sink has
/// accepted. Durations are derived from it, never from what the audio callback
/// delivered, so a failing disk cannot make a recording look longer than the
/// file is (C2).
pub struct WavWriter<W: WavSink> {
    inner: W,
    buf: Vec<u8>,
    sample_rate: u32,
    channels: u16,
    bytes_committed: u64,
    /// The first write failure. Once set, further samples are refused.
    failed: Option<String>,
}

impl WavWriter<File> {
    /// Create the file (owner-only) and write a header with zero sizes.
    pub fn create(path: &Path, sample_rate: u32, channels: u16) -> Result<Self, String> {
        let file = create_private_file(path)
            .map_err(|e| format!("Failed to create WAV file: {}", e))?;
        Self::new(file, sample_rate, channels)
    }
}

impl<W: WavSink> WavWriter<W> {
    pub fn new(mut inner: W, sample_rate: u32, channels: u16) -> Result<Self, String> {
        inner
            .write_all(&wav_header(sample_rate, channels, 0))
            .map_err(|e| format!("Failed to write WAV header: {}", e))?;
        Ok(Self {
            inner,
            buf: Vec::with_capacity(FLUSH_THRESHOLD + 8 * 1024),
            sample_rate,
            channels,
            bytes_committed: 0,
            failed: None,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Interleaved samples that have reached the sink.
    pub fn samples_committed(&self) -> u64 {
        self.bytes_committed / 2
    }

    /// Interleaved samples accepted so far: committed plus still buffered.
    /// Used for the live elapsed time; the final duration uses
    /// [`Self::samples_committed`] after the last flush.
    pub fn samples_accepted(&self) -> u64 {
        (self.bytes_committed + self.buf.len() as u64) / 2
    }

    pub fn failure(&self) -> Option<&str> {
        self.failed.as_deref()
    }

    fn check_room(&self, more_bytes: u64) -> Result<(), String> {
        if let Some(e) = &self.failed {
            return Err(e.clone());
        }
        if self.bytes_committed + self.buf.len() as u64 + more_bytes > MAX_DATA_BYTES {
            return Err(WAV_FULL.to_string());
        }
        Ok(())
    }

    /// Append float samples (interleaved if multi-channel).
    pub fn write_f32(&mut self, data: &[f32]) -> Result<(), String> {
        self.check_room(data.len() as u64 * 2)?;
        for &s in data {
            self.buf.extend_from_slice(&f32_to_i16(s).to_le_bytes());
        }
        self.flush_if_large()
    }

    /// Append `frames` frames of silence.
    pub fn write_silence(&mut self, frames: u64) -> Result<(), String> {
        let mut remaining = frames.saturating_mul(self.channels.max(1) as u64 * 2);
        self.check_room(remaining)?;
        while remaining > 0 {
            let n = remaining.min(FLUSH_THRESHOLD as u64) as usize;
            self.buf.resize(self.buf.len() + n, 0);
            remaining -= n as u64;
            self.flush_if_large()?;
        }
        Ok(())
    }

    fn flush_if_large(&mut self) -> Result<(), String> {
        if self.buf.len() >= FLUSH_THRESHOLD {
            self.flush_data()
        } else {
            Ok(())
        }
    }

    /// Hand buffered samples to the sink. On failure the buffered samples are
    /// dropped (how many of them landed is unknowable) and the writer refuses
    /// everything after: the committed count stays a lower bound that the
    /// header can safely describe.
    pub fn flush_data(&mut self) -> Result<(), String> {
        if let Some(e) = &self.failed {
            return Err(e.clone());
        }
        if self.buf.is_empty() {
            return Ok(());
        }
        match self.inner.write_all(&self.buf) {
            Ok(()) => {
                self.bytes_committed += self.buf.len() as u64;
                self.buf.clear();
                Ok(())
            }
            Err(e) => {
                let msg = format!("Failed to write WAV samples: {}", e);
                self.buf.clear();
                self.failed = Some(msg.clone());
                Err(msg)
            }
        }
    }

    /// Flush, then rewrite the RIFF and data sizes for what has been committed
    /// and return to the append position. Safe to call at any time and any
    /// number of times; after it the file is a valid WAV of everything written
    /// so far.
    ///
    /// Returns only header I/O errors. A failed data flush does not stop the
    /// header from being patched (the sizes then describe the samples that did
    /// land); it is reported through [`Self::failure`].
    pub fn patch_header(&mut self) -> Result<(), String> {
        let _ = self.flush_data();
        let data_bytes = self.bytes_committed.min(MAX_DATA_BYTES) as u32;
        let riff_size = 36 + data_bytes;
        let io = |e: std::io::Error| format!("WAV header update failed: {}", e);

        self.inner.seek(SeekFrom::Start(4)).map_err(io)?;
        self.inner.write_all(&riff_size.to_le_bytes()).map_err(io)?;
        self.inner.seek(SeekFrom::Start(40)).map_err(io)?;
        self.inner.write_all(&data_bytes.to_le_bytes()).map_err(io)?;
        self.inner
            .seek(SeekFrom::Start(WAV_HEADER_LEN + self.bytes_committed))
            .map_err(io)?;
        self.inner.flush().map_err(io)?;
        // Persisting is best effort: a header that is in the page cache already
        // survives an app crash, which is the case this exists for.
        let _ = self.inner.sync();
        Ok(())
    }

    /// Final header patch. Returns the interleaved samples committed.
    pub fn finalize(mut self) -> Result<u64, String> {
        self.patch_header()?;
        Ok(self.samples_committed())
    }

    #[cfg(test)]
    pub fn into_inner(self) -> W {
        self.inner
    }
}

/// What a WAV header says, after validation against the file's real length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WavInfo {
    pub sample_rate: u32,
    pub channels: u16,
    /// Bytes of sample data actually present in the file.
    pub data_bytes: u64,
    /// The header was wrong and has been rewritten.
    pub repaired: bool,
}

impl WavInfo {
    pub fn frames(&self) -> u64 {
        self.data_bytes / (self.channels.max(1) as u64 * 2)
    }

    pub fn duration_secs(&self) -> f64 {
        duration_from_samples(self.data_bytes / 2, self.sample_rate, self.channels)
    }
}

fn parse_canonical_header(h: &[u8; 44]) -> Result<(u32, u16, u32), String> {
    if &h[0..4] != b"RIFF" || &h[8..12] != b"WAVE" || &h[12..16] != b"fmt " {
        return Err("Not a WAV file".into());
    }
    let fmt_len = u32::from_le_bytes([h[16], h[17], h[18], h[19]]);
    let format = u16::from_le_bytes([h[20], h[21]]);
    let channels = u16::from_le_bytes([h[22], h[23]]);
    let sample_rate = u32::from_le_bytes([h[24], h[25], h[26], h[27]]);
    let bits = u16::from_le_bytes([h[34], h[35]]);
    if fmt_len != 16 || format != 1 || bits != 16 || &h[36..40] != b"data" {
        return Err("Not a 16-bit PCM WAV written by Notesage".into());
    }
    if channels == 0 || sample_rate == 0 {
        return Err("WAV header has no channels or sample rate".into());
    }
    let data = u32::from_le_bytes([h[40], h[41], h[42], h[43]]);
    Ok((sample_rate, channels, data))
}

/// Read a canonical WAV header and, when its sizes disagree with the file
/// length, rewrite them from the length (C3). A crash leaves either zero sizes
/// (never patched) or sizes from the last periodic patch (data kept arriving
/// afterwards); a truncated copy leaves sizes larger than the file. All three
/// are repaired to "everything that is in the file", rounded down to whole
/// frames.
pub fn repair_wav_header(path: &Path) -> Result<WavInfo, String> {
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| format!("Cannot open {}: {}", path.display(), e))?;
    let len = file
        .metadata()
        .map_err(|e| format!("Cannot stat {}: {}", path.display(), e))?
        .len();
    if len < WAV_HEADER_LEN {
        return Err(format!("{} is too short to be a WAV file", path.display()));
    }
    let mut header = [0u8; 44];
    file.read_exact(&mut header)
        .map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
    let (sample_rate, channels, header_data) = parse_canonical_header(&header)?;

    let block = channels as u64 * 2;
    let present = (len - WAV_HEADER_LEN).min(MAX_DATA_BYTES);
    let data_bytes = present - present % block;
    let header_riff = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);
    let repaired = header_data as u64 != data_bytes || header_riff as u64 != 36 + data_bytes;
    if repaired {
        let io = |e: std::io::Error| format!("Cannot repair {}: {}", path.display(), e);
        file.seek(SeekFrom::Start(4)).map_err(io)?;
        file.write_all(&((36 + data_bytes) as u32).to_le_bytes()).map_err(io)?;
        file.seek(SeekFrom::Start(40)).map_err(io)?;
        file.write_all(&(data_bytes as u32).to_le_bytes()).map_err(io)?;
        file.flush().map_err(io)?;
        let _ = file.sync_data();
    }
    Ok(WavInfo { sample_rate, channels, data_bytes, repaired })
}

/// Streaming reader for the WAVs this module writes. Yields mono float
/// samples (multi-channel files are averaged), a bounded chunk at a time.
pub struct WavReader {
    reader: std::io::BufReader<File>,
    pub sample_rate: u32,
    pub channels: u16,
    frames_left: u64,
    raw: Vec<u8>,
}

impl WavReader {
    /// Opens read-only and trusts the file length over the header sizes, so an
    /// unrepaired file reads the same as a repaired one.
    pub fn open(path: &Path) -> Result<Self, String> {
        let mut file =
            File::open(path).map_err(|e| format!("Cannot open {}: {}", path.display(), e))?;
        let len = file
            .metadata()
            .map_err(|e| format!("Cannot stat {}: {}", path.display(), e))?
            .len();
        if len < WAV_HEADER_LEN {
            return Err(format!("{} is too short to be a WAV file", path.display()));
        }
        let mut header = [0u8; 44];
        file.read_exact(&mut header)
            .map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
        let (sample_rate, channels, _) = parse_canonical_header(&header)?;
        let block = channels as u64 * 2;
        Ok(Self {
            reader: std::io::BufReader::with_capacity(256 * 1024, file),
            sample_rate,
            channels,
            frames_left: (len - WAV_HEADER_LEN) / block,
            raw: Vec::new(),
        })
    }

    #[cfg(test)]
    pub fn frames_left(&self) -> u64 {
        self.frames_left
    }

    /// Append up to `max_frames` mono samples to `out`. Returns how many were
    /// appended; 0 means end of file.
    pub fn read_mono(&mut self, out: &mut Vec<f32>, max_frames: usize) -> Result<usize, String> {
        let frames = (max_frames as u64).min(self.frames_left) as usize;
        if frames == 0 {
            return Ok(0);
        }
        let ch = self.channels as usize;
        self.raw.resize(frames * ch * 2, 0);
        self.reader
            .read_exact(&mut self.raw)
            .map_err(|e| format!("Cannot read WAV samples: {}", e))?;
        self.frames_left -= frames as u64;
        const SCALE: f32 = 1.0 / i16::MAX as f32;
        for frame in self.raw.chunks_exact(ch * 2) {
            let mut sum = 0.0f32;
            for s in frame.chunks_exact(2) {
                sum += i16::from_le_bytes([s[0], s[1]]) as f32 * SCALE;
            }
            out.push(sum / ch as f32);
        }
        Ok(frames)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn header_sizes(bytes: &[u8]) -> (u32, u32) {
        (
            u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
            u32::from_le_bytes([bytes[40], bytes[41], bytes[42], bytes[43]]),
        )
    }

    #[test]
    fn duration_from_samples_is_pause_aware() {
        assert_eq!(duration_from_samples(16_000, 16_000, 1), 1.0);
        assert_eq!(duration_from_samples(480_000, 48_000, 2), 5.0);
        assert_eq!(duration_from_samples(0, 48_000, 2), 0.0);
        assert_eq!(duration_from_samples(100, 0, 0), 0.0);
    }

    /// C3: the header is valid after a patch at ANY point, and writing simply
    /// continues after it.
    #[test]
    fn header_can_be_patched_mid_stream_and_writing_continues() {
        let mut w = WavWriter::new(Cursor::new(Vec::new()), 48_000, 1).unwrap();
        w.write_f32(&[0.5; 1000]).unwrap();
        w.patch_header().unwrap();
        assert_eq!(w.samples_committed(), 1000);

        w.write_f32(&[-0.5; 500]).unwrap();
        // Not yet patched: the header still describes the first 1000 samples.
        w.patch_header().unwrap();
        let bytes = w.into_inner().into_inner();
        assert_eq!(bytes.len(), 44 + 3000);
        assert_eq!(header_sizes(&bytes), (36 + 3000, 3000));
        // The samples after the first patch were appended, not written over
        // the header or the earlier data.
        let first = i16::from_le_bytes([bytes[44], bytes[45]]);
        let last = i16::from_le_bytes([bytes[44 + 2998], bytes[44 + 2999]]);
        assert!(first > 16_000 && last < -16_000, "{first} {last}");
    }

    #[test]
    fn unpatched_header_describes_only_the_last_patch() {
        let mut w = WavWriter::new(Cursor::new(Vec::new()), 16_000, 1).unwrap();
        w.write_f32(&[0.1; 100]).unwrap();
        w.patch_header().unwrap();
        w.write_f32(&[0.1; 100]).unwrap();
        w.flush_data().unwrap();
        let bytes = w.into_inner().into_inner();
        assert_eq!(bytes.len(), 44 + 400);
        assert_eq!(header_sizes(&bytes), (36 + 200, 200), "crash-shaped: stale sizes");
    }

    #[test]
    fn silence_is_written_in_frames_and_large_writes_flush() {
        let mut w = WavWriter::new(Cursor::new(Vec::new()), 48_000, 2).unwrap();
        w.write_silence(100_000).unwrap();
        // 400 kB: several flush thresholds were crossed without a patch.
        assert!(w.samples_committed() > 0);
        assert_eq!(w.samples_accepted(), 200_000);
        assert_eq!(w.finalize().unwrap(), 200_000);
    }

    /// A sink that accepts `limit` bytes and then fails every write.
    struct FailingSink {
        data: Cursor<Vec<u8>>,
        limit: usize,
    }
    impl Write for FailingSink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if self.data.position() as usize >= 44
                && self.data.get_ref().len() + buf.len() > self.limit
            {
                return Err(std::io::Error::new(std::io::ErrorKind::Other, "disk full"));
            }
            self.data.write(buf)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl Seek for FailingSink {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
            self.data.seek(pos)
        }
    }
    impl WavSink for FailingSink {}

    /// C2: a failed write is surfaced, later writes are refused, and the
    /// committed count (hence the duration) covers only what reached the file.
    #[test]
    fn write_failure_is_surfaced_and_duration_counts_only_committed_samples() {
        let sink = FailingSink { data: Cursor::new(Vec::new()), limit: 44 + 100_000 };
        let mut w = WavWriter::new(sink, 48_000, 1).unwrap();

        // 40 000 samples = 80 kB: one flush (>= 64 kB) succeeds.
        w.write_f32(&vec![0.25; 40_000]).unwrap();
        assert_eq!(w.samples_committed(), 40_000);

        // The next 40 000 would pass 100 kB: the flush fails.
        let err = w.write_f32(&vec![0.25; 40_000]).unwrap_err();
        assert!(err.contains("disk full"), "{err}");
        assert_eq!(w.samples_committed(), 40_000, "failed samples must not count");
        assert_eq!(w.samples_accepted(), 40_000);
        assert!(w.failure().is_some());

        // Everything after is refused with the same error, not silently dropped.
        assert!(w.write_f32(&[0.0; 10]).is_err());
        assert_eq!(duration_from_samples(w.samples_committed(), 48_000, 1), 40_000.0 / 48_000.0);

        // The header can still be finalised for what did land.
        assert_eq!(w.finalize().unwrap(), 40_000);
    }

    /// The RIFF sizes are 32-bit. Past the limit the writer refuses instead of
    /// wrapping the size fields (which would describe a few seconds of a
    /// 13-hour file).
    #[test]
    fn refuses_to_grow_past_the_riff_limit() {
        let mut w = WavWriter::new(Cursor::new(Vec::new()), 48_000, 1).unwrap();
        // Pretend almost 4 GiB were written without allocating them.
        w.bytes_committed = MAX_DATA_BYTES - 10;
        assert!(w.write_f32(&[0.0; 5]).is_ok(), "exactly up to the limit is fine");
        assert_eq!(w.write_f32(&[0.0; 1]).unwrap_err(), WAV_FULL);
        assert_eq!(w.write_silence(1).unwrap_err(), WAV_FULL);
        assert!(w.failure().is_none(), "the size guard is not an I/O failure");
        assert!(MAX_DATA_BYTES + 36 <= u32::MAX as u64);
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "notesage-wav-{}-{}-{:?}",
            tag,
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// C3: a file whose header was never patched (sizes 0) is repaired from
    /// its length, and reads back in full.
    #[test]
    fn crash_shaped_file_is_repaired_from_its_length() {
        let dir = temp_dir("crash");
        let path = dir.join("audio.wav");
        {
            let mut w = WavWriter::create(&path, 44_100, 1).unwrap();
            w.write_f32(&[0.5; 4410]).unwrap();
            w.flush_data().unwrap();
            // Dropped without finalize: the process "crashed".
        }
        let raw = std::fs::read(&path).unwrap();
        assert_eq!(header_sizes(&raw), (36, 0));

        let info = repair_wav_header(&path).unwrap();
        assert!(info.repaired);
        assert_eq!(info.data_bytes, 8820);
        assert_eq!(info.frames(), 4410);
        assert!((info.duration_secs() - 0.1).abs() < 1e-9);
        let raw = std::fs::read(&path).unwrap();
        assert_eq!(header_sizes(&raw), (36 + 8820, 8820));

        // Idempotent.
        let again = repair_wav_header(&path).unwrap();
        assert!(!again.repaired);
        assert_eq!(again.data_bytes, 8820);

        let mut r = WavReader::open(&path).unwrap();
        let mut out = Vec::new();
        assert_eq!(r.read_mono(&mut out, 10_000).unwrap(), 4410);
        assert_eq!(r.read_mono(&mut out, 10_000).unwrap(), 0);
        assert!((out[0] - 0.5).abs() < 1e-3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn repair_handles_stale_truncated_and_odd_length_files() {
        let dir = temp_dir("stale");
        let path = dir.join("audio.wav");
        // Stereo, header claims 1000 bytes, file holds 4003 (a torn frame).
        let mut bytes = wav_header(48_000, 2, 1000).to_vec();
        bytes.extend(std::iter::repeat(1u8).take(4003));
        std::fs::write(&path, &bytes).unwrap();
        let info = repair_wav_header(&path).unwrap();
        assert!(info.repaired);
        assert_eq!(info.data_bytes, 4000, "rounded down to whole stereo frames");

        // Header claims more than the file holds (truncated copy).
        let mut bytes = wav_header(48_000, 1, 50_000).to_vec();
        bytes.extend(std::iter::repeat(0u8).take(200));
        std::fs::write(&path, &bytes).unwrap();
        let info = repair_wav_header(&path).unwrap();
        assert!(info.repaired);
        assert_eq!(info.data_bytes, 200);

        // Header only: valid, zero data.
        std::fs::write(&path, wav_header(48_000, 1, 0)).unwrap();
        let info = repair_wav_header(&path).unwrap();
        assert!(!info.repaired);
        assert_eq!(info.data_bytes, 0);

        // Not a WAV: refused, and left alone.
        std::fs::write(&path, vec![7u8; 100]).unwrap();
        assert!(repair_wav_header(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), vec![7u8; 100]);
        std::fs::write(&path, b"RIFF").unwrap();
        assert!(repair_wav_header(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reader_downmixes_and_respects_chunk_size() {
        let dir = temp_dir("reader");
        let path = dir.join("stereo.wav");
        let mut w = WavWriter::create(&path, 48_000, 2).unwrap();
        // L = 0.5, R = -0.25 → mono 0.125.
        let frames: Vec<f32> = (0..300).flat_map(|_| [0.5f32, -0.25]).collect();
        w.write_f32(&frames).unwrap();
        w.finalize().unwrap();

        let mut r = WavReader::open(&path).unwrap();
        assert_eq!((r.sample_rate, r.channels, r.frames_left()), (48_000, 2, 300));
        let mut out = Vec::new();
        assert_eq!(r.read_mono(&mut out, 100).unwrap(), 100);
        assert_eq!(r.read_mono(&mut out, 1000).unwrap(), 200);
        assert_eq!(out.len(), 300);
        assert!(out.iter().all(|s| (s - 0.125).abs() < 1e-3));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// S5: recordings are private to the user.
    #[cfg(unix)]
    #[test]
    fn created_wav_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("perm");
        let path = dir.join("audio.wav");
        WavWriter::create(&path, 48_000, 1).unwrap().finalize().unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "mode {:o}", mode);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
