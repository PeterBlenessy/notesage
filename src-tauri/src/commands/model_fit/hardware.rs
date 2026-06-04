//! Hardware profile detection — RAM (via sysinfo) + memory bandwidth + chip
//! identity. Bandwidth is the dominant factor in decode speed and cannot be
//! read from `sysinfo`, so it is looked up from a small static table keyed by
//! Apple chip. The table is the one piece of curated data this feature keeps —
//! it is hardware spec (stable, small), not model-quality data.

use super::types::HardwareProfile;

/// Read the chip / CPU brand string. On Apple Silicon this returns e.g.
/// "Apple M3 Pro"; on Intel Macs a CPU brand; "unknown" elsewhere.
fn detect_chip_name() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
        {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !s.is_empty() {
                    return s;
                }
            }
        }
    }
    "unknown".to_string()
}

/// Look up sustained memory bandwidth (GB/s) for a known Apple chip.
///
/// Entries are ordered most-specific-first within each generation so the
/// substring match returns the right tier (e.g. "M3 Max" before "M3"). Returns
/// `None` for chips not in the table (caller applies a conservative fallback).
fn bandwidth_for_chip(chip: &str) -> Option<f32> {
    let c = chip.to_lowercase();
    // (substring, GB/s) — published unified-memory bandwidth figures.
    const TABLE: &[(&str, f32)] = &[
        ("m1 ultra", 800.0),
        ("m1 max", 400.0),
        ("m1 pro", 200.0),
        ("m1", 68.0),
        ("m2 ultra", 800.0),
        ("m2 max", 400.0),
        ("m2 pro", 200.0),
        ("m2", 100.0),
        ("m3 ultra", 800.0),
        ("m3 max", 400.0),
        ("m3 pro", 150.0),
        ("m3", 100.0),
        ("m4 max", 546.0),
        ("m4 pro", 273.0),
        ("m4", 120.0),
    ];
    for (key, bw) in TABLE {
        if c.contains(key) {
            return Some(*bw);
        }
    }
    None
}

/// Build a hardware profile for the current machine.
#[tauri::command]
pub async fn detect_hardware_profile() -> Result<HardwareProfile, String> {
    use sysinfo::{MemoryRefreshKind, RefreshKind, System};
    let sys = System::new_with_specifics(
        RefreshKind::nothing().with_memory(MemoryRefreshKind::everything()),
    );

    let chip = detect_chip_name();
    let is_apple_silicon = chip.to_lowercase().contains("apple m");
    let bandwidth_gbs = bandwidth_for_chip(&chip).unwrap_or(if is_apple_silicon {
        // Unknown Apple chip (newer than the table) — conservative base tier.
        100.0
    } else {
        // Non-unified host (Intel / other) — conservative RAM-bound estimate.
        50.0
    });

    Ok(HardwareProfile {
        total_ram_bytes: sys.total_memory(),
        available_ram_bytes: sys.available_memory(),
        chip_name: chip,
        bandwidth_gbs,
        is_unified: is_apple_silicon,
        backend: if is_apple_silicon { "metal" } else { "cpu" }.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_chips_resolve_to_specific_tiers() {
        assert_eq!(bandwidth_for_chip("Apple M3 Max"), Some(400.0));
        assert_eq!(bandwidth_for_chip("Apple M3 Pro"), Some(150.0));
        assert_eq!(bandwidth_for_chip("Apple M3"), Some(100.0));
        assert_eq!(bandwidth_for_chip("Apple M4 Pro"), Some(273.0));
        assert_eq!(bandwidth_for_chip("Apple M1 Ultra"), Some(800.0));
    }

    #[test]
    fn specific_tier_wins_over_base() {
        // "M3 Max" must not resolve to the bare "M3" entry.
        assert_eq!(bandwidth_for_chip("Apple M3 Max"), Some(400.0));
        assert_ne!(bandwidth_for_chip("Apple M3 Max"), Some(100.0));
    }

    #[test]
    fn unknown_chip_returns_none() {
        assert_eq!(bandwidth_for_chip("Intel Core i9"), None);
        assert_eq!(bandwidth_for_chip("unknown"), None);
    }
}
