//! Lock-free single-producer / single-consumer ring of `f32` samples.
//!
//! The audio callback runs on CoreAudio's real-time thread, where a lock, an
//! allocation or a `write(2)` can each cause a dropout (C4). The callback's
//! whole job is therefore `Producer::push_slice`: copy the block into
//! preallocated storage and publish one index. The capture thread drains it at
//! its leisure.
//!
//! Samples are stored as `AtomicU32` bit patterns, which keeps this entirely
//! safe Rust (no `UnsafeCell`) and costs nothing: a relaxed atomic store of a
//! word is a plain move on arm64 and x86-64. Correctness rests on the two
//! indices: only the producer writes `head`, only the consumer writes `tail`,
//! and a slot is read only after the `head` that covers it was published.

use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

struct Shared {
    slots: Box<[AtomicU32]>,
    mask: usize,
    /// Total samples ever written (wrapping). Written by the producer only.
    head: AtomicUsize,
    /// Total samples ever read (wrapping). Written by the consumer only.
    tail: AtomicUsize,
    /// Samples refused because the ring was full.
    dropped: AtomicU64,
}

pub struct Producer {
    shared: Arc<Shared>,
}

pub struct Consumer {
    shared: Arc<Shared>,
}

/// Create a ring holding at least `min_capacity` samples (rounded up to a
/// power of two).
pub fn ring(min_capacity: usize) -> (Producer, Consumer) {
    let capacity = min_capacity.max(2).next_power_of_two();
    let slots: Vec<AtomicU32> = (0..capacity).map(|_| AtomicU32::new(0)).collect();
    let shared = Arc::new(Shared {
        slots: slots.into_boxed_slice(),
        mask: capacity - 1,
        head: AtomicUsize::new(0),
        tail: AtomicUsize::new(0),
        dropped: AtomicU64::new(0),
    });
    (Producer { shared: shared.clone() }, Consumer { shared })
}

impl Producer {
    /// Copy a whole block in, or none of it. A block that does not fit is
    /// counted as dropped and `false` is returned: a partial block would tear
    /// an interleaved frame and shift the channels of everything after it.
    ///
    /// Real-time safe: no locks, no allocation, no system calls.
    #[inline]
    pub fn push_slice(&mut self, data: &[f32]) -> bool {
        let s = &*self.shared;
        let head = s.head.load(Ordering::Relaxed);
        let tail = s.tail.load(Ordering::Acquire);
        let used = head.wrapping_sub(tail);
        let free = s.slots.len() - used;
        if data.len() > free {
            s.dropped.fetch_add(data.len() as u64, Ordering::Relaxed);
            return false;
        }
        for (i, &v) in data.iter().enumerate() {
            s.slots[head.wrapping_add(i) & s.mask].store(v.to_bits(), Ordering::Relaxed);
        }
        s.head.store(head.wrapping_add(data.len()), Ordering::Release);
        true
    }
}

impl Consumer {
    /// Samples waiting to be read.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        let s = &*self.shared;
        s.head.load(Ordering::Acquire).wrapping_sub(s.tail.load(Ordering::Relaxed))
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[cfg(test)]
    pub fn capacity(&self) -> usize {
        self.shared.slots.len()
    }

    /// Samples the producer had to drop because the ring was full.
    pub fn dropped(&self) -> u64 {
        self.shared.dropped.load(Ordering::Relaxed)
    }

    /// Append up to `max` waiting samples to `out`, oldest first. Returns the
    /// number appended.
    pub fn pop_into(&mut self, out: &mut Vec<f32>, max: usize) -> usize {
        let s = &*self.shared;
        let tail = s.tail.load(Ordering::Relaxed);
        let head = s.head.load(Ordering::Acquire);
        let n = head.wrapping_sub(tail).min(max);
        out.reserve(n);
        for i in 0..n {
            let bits = s.slots[tail.wrapping_add(i) & s.mask].load(Ordering::Relaxed);
            out.push(f32::from_bits(bits));
        }
        s.tail.store(tail.wrapping_add(n), Ordering::Release);
        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_order_across_wraparound() {
        let (mut p, mut c) = ring(8);
        assert_eq!(c.capacity(), 8);
        let mut expected = Vec::new();
        let mut got = Vec::new();
        let mut next = 0.0f32;
        // Blocks of 5 through a ring of 8: every other block wraps.
        for _ in 0..50 {
            let block: Vec<f32> = (0..5).map(|_| { next += 1.0; next }).collect();
            assert!(p.push_slice(&block));
            expected.extend_from_slice(&block);
            assert_eq!(c.pop_into(&mut got, usize::MAX), 5);
        }
        assert_eq!(got, expected);
        assert_eq!(c.dropped(), 0);
        assert!(c.is_empty());
    }

    #[test]
    fn overflow_drops_whole_blocks_and_counts_them() {
        let (mut p, mut c) = ring(8);
        assert!(p.push_slice(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]));
        // 4 do not fit in the 2 free slots: the whole block is refused.
        assert!(!p.push_slice(&[7.0, 8.0, 9.0, 10.0]));
        assert_eq!(c.dropped(), 4);
        assert_eq!(c.len(), 6, "a refused block leaves nothing behind");
        // A block that does fit is still accepted afterwards.
        assert!(p.push_slice(&[11.0, 12.0]));
        assert!(!p.push_slice(&[13.0]));
        assert_eq!(c.dropped(), 5);

        let mut out = Vec::new();
        assert_eq!(c.pop_into(&mut out, 4), 4);
        assert_eq!(c.pop_into(&mut out, usize::MAX), 4);
        assert_eq!(out, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 11.0, 12.0]);
        // Space is back.
        assert!(p.push_slice(&[0.5; 8]));
    }

    #[test]
    fn empty_push_and_pop_are_harmless() {
        let (mut p, mut c) = ring(4);
        assert!(p.push_slice(&[]));
        let mut out = Vec::new();
        assert_eq!(c.pop_into(&mut out, 10), 0);
        assert!(out.is_empty());
    }

    #[test]
    fn bit_patterns_survive() {
        let (mut p, mut c) = ring(4);
        p.push_slice(&[-0.0, f32::MIN_POSITIVE, -1.0]);
        let mut out = Vec::new();
        c.pop_into(&mut out, 10);
        assert_eq!(out[0].to_bits(), (-0.0f32).to_bits());
        assert_eq!(out[1], f32::MIN_POSITIVE);
        assert_eq!(out[2], -1.0);
    }

    /// The real arrangement: a producer thread pushing blocks as fast as it
    /// can while a consumer drains. Whatever was accepted arrives exactly
    /// once, in order; whatever was not is counted.
    #[test]
    fn concurrent_producer_and_consumer_lose_nothing_uncounted() {
        let (mut p, mut c) = ring(1024);
        const BLOCKS: usize = 20_000;
        const BLOCK: usize = 64;
        let producer = std::thread::spawn(move || {
            let mut accepted = 0u64;
            let mut value = 0u32;
            for _ in 0..BLOCKS {
                let block: Vec<f32> =
                    (0..BLOCK).map(|i| (value as usize + i) as f32).collect();
                if p.push_slice(&block) {
                    accepted += BLOCK as u64;
                    value += BLOCK as u32;
                }
                if value >= 16_000_000 {
                    value = 0;
                }
            }
            accepted
        });

        let mut out = Vec::new();
        let mut received = 0u64;
        let mut expected_next: Option<f32> = None;
        loop {
            out.clear();
            let n = c.pop_into(&mut out, 4096);
            for &v in &out {
                if let Some(e) = expected_next {
                    // Values are consecutive within the accepted stream
                    // (resetting to 0 at the wrap point).
                    assert!(v == e || v == 0.0, "out of order: got {v}, expected {e}");
                }
                expected_next = Some(v + 1.0);
            }
            received += n as u64;
            if n == 0 && producer.is_finished() && c.is_empty() {
                break;
            }
        }
        let accepted = producer.join().unwrap();
        assert_eq!(received, accepted);
        assert_eq!(accepted + c.dropped(), (BLOCKS * BLOCK) as u64);
    }
}
