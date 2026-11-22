//! UTF-8 helpers for text that arrives in arbitrary byte chunks.
//!
//! A network stream splits wherever the transport likes, including in the
//! middle of a multibyte character. Decoding each chunk on its own with
//! `String::from_utf8_lossy` turns both halves of such a character into
//! U+FFFD, and that corrupted text ends up in the user's document.

/// Decodes a byte stream chunk by chunk, holding back an incomplete trailing
/// UTF-8 sequence until the chunk that completes it arrives.
#[derive(Default)]
pub struct Utf8ChunkDecoder {
    /// The unfinished sequence at the end of the previous chunk (at most 3 bytes).
    pending: Vec<u8>,
}

impl Utf8ChunkDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Decode the next chunk and return every complete character so far.
    ///
    /// Bytes that can never be valid UTF-8 become U+FFFD (as with
    /// `from_utf8_lossy`); a sequence that is merely cut off by the end of the
    /// chunk is kept for the next call instead. A sequence still unfinished
    /// when the stream ends is dropped — the callers discard an unterminated
    /// trailing line anyway.
    pub fn decode(&mut self, chunk: &[u8]) -> String {
        // Fast path: nothing held back and the chunk is whole.
        if self.pending.is_empty() {
            if let Ok(text) = std::str::from_utf8(chunk) {
                return text.to_string();
            }
        }

        let mut bytes = std::mem::take(&mut self.pending);
        bytes.extend_from_slice(chunk);

        let mut out = String::with_capacity(bytes.len());
        let mut rest: &[u8] = &bytes;
        loop {
            match std::str::from_utf8(rest) {
                Ok(text) => {
                    out.push_str(text);
                    break;
                }
                Err(err) => {
                    let (valid, after) = rest.split_at(err.valid_up_to());
                    // `valid` was just checked by `from_utf8`.
                    out.push_str(std::str::from_utf8(valid).unwrap_or_default());
                    match err.error_len() {
                        // Invalid bytes: replace them and carry on.
                        Some(len) => {
                            out.push(char::REPLACEMENT_CHARACTER);
                            rest = &after[len..];
                        }
                        // Cut off mid-character: wait for the next chunk.
                        None => {
                            self.pending = after.to_vec();
                            break;
                        }
                    }
                }
            }
        }
        out
    }
}

/// The largest index `<= index` that is a char boundary of `s`, so that
/// `&s[..floor_char_boundary(s, i)]` can never panic.
pub fn floor_char_boundary(s: &str, index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    let mut i = index;
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed `bytes` split at every possible position and require the same text.
    fn assert_split_anywhere(text: &str) {
        let bytes = text.as_bytes();
        for split in 0..=bytes.len() {
            let mut decoder = Utf8ChunkDecoder::new();
            let mut out = decoder.decode(&bytes[..split]);
            out.push_str(&decoder.decode(&bytes[split..]));
            assert!(decoder.pending.is_empty(), "split at byte {}", split);
            assert_eq!(out, text, "split at byte {}", split);
        }
    }

    #[test]
    fn ascii_passes_straight_through() {
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(b"data: {\"a\":1}\n\n"), "data: {\"a\":1}\n\n");
        assert!(decoder.pending.is_empty());
    }

    #[test]
    fn two_byte_characters_survive_any_split() {
        assert_split_anywhere("Hallå, världen — smörgåsbord");
    }

    #[test]
    fn three_and_four_byte_characters_survive_any_split() {
        assert_split_anywhere("日本語のテキスト");
        assert_split_anywhere("ok 👍🏽 done 🎉");
    }

    #[test]
    fn a_character_spread_over_three_chunks_is_reassembled() {
        let emoji = "🎉".as_bytes(); // 4 bytes
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(&emoji[..1]), "");
        assert_eq!(decoder.decode(&emoji[1..3]), "");
        assert_eq!(decoder.decode(&emoji[3..]), "🎉");
    }

    #[test]
    fn one_byte_at_a_time_matches_the_original() {
        let text = "data: {\"delta\":\"åäö 漢字 🙂\"}\n\n";
        let mut decoder = Utf8ChunkDecoder::new();
        let mut out = String::new();
        for byte in text.as_bytes() {
            out.push_str(&decoder.decode(std::slice::from_ref(byte)));
        }
        assert_eq!(out, text);
        assert!(!out.contains(char::REPLACEMENT_CHARACTER));
    }

    #[test]
    fn invalid_bytes_are_replaced_without_swallowing_what_follows() {
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(b"a\xFFb"), "a\u{FFFD}b");
        // A lead byte followed by a non-continuation byte is invalid, not incomplete.
        assert_eq!(decoder.decode(b"\xC3("), "\u{FFFD}(");
        assert!(decoder.pending.is_empty());
    }

    #[test]
    fn an_unfinished_sequence_is_held_back_not_emitted_as_garbage() {
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.decode(&"å".as_bytes()[..1]), "");
        assert_eq!(decoder.pending, vec![0xC3]);
        // Never more than an incomplete character (3 bytes) is retained.
        assert_eq!(decoder.decode(&"🎉".as_bytes()[..3]), "\u{FFFD}");
        assert_eq!(decoder.pending.len(), 3);
    }

    #[test]
    fn floor_char_boundary_never_lands_inside_a_character() {
        let s = "aå🎉"; // 1 + 2 + 4 bytes
        assert_eq!(floor_char_boundary(s, 0), 0);
        assert_eq!(floor_char_boundary(s, 1), 1);
        assert_eq!(floor_char_boundary(s, 2), 1);
        assert_eq!(floor_char_boundary(s, 3), 3);
        assert_eq!(floor_char_boundary(s, 4), 3);
        assert_eq!(floor_char_boundary(s, 6), 3);
        assert_eq!(floor_char_boundary(s, 7), 7);
        assert_eq!(floor_char_boundary(s, 99), 7);
        for i in 0..=s.len() + 2 {
            let _ = &s[..floor_char_boundary(s, i)]; // must not panic
        }
    }
}
