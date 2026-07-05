//! Shared SSRF IP blocklist.
//!
//! One list, two call sites (audit batch 3 fix #10): `link_preview.rs`
//! (OpenGraph metadata fetch) and `mcp_oauth.rs` (OAuth discovery/token
//! endpoints from attacker-controllable metadata) previously carried separate
//! near-copies that had already drifted — the OAuth copy was missing CGNAT,
//! broadcast, documentation ranges, and 0.0.0.0/8. This module is the
//! superset; both call sites route through it so the lists can never diverge
//! again.

use std::net::IpAddr;

/// True if an IP is in a range we must never fetch from the main (unsandboxed)
/// process when the target is externally influenced: loopback, RFC-1918
/// private, link-local (incl. the 169.254.169.254 cloud-metadata endpoint),
/// CGNAT, broadcast, unspecified, documentation ranges, and the IPv6
/// unique-local / link-local equivalents. IPv4-mapped IPv6 addresses are
/// unwrapped and checked as IPv4.
pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()            // 127.0.0.0/8
                || v4.is_private()      // 10/8, 172.16/12, 192.168/16
                || v4.is_link_local()   // 169.254.0.0/16 (incl. 169.254.169.254 metadata)
                || v4.is_broadcast()    // 255.255.255.255
                || v4.is_unspecified()  // 0.0.0.0
                || v4.is_documentation()
                || o[0] == 0            // 0.0.0.0/8
                || (o[0] == 100 && (o[1] & 0xc0) == 0x40) // 100.64.0.0/10 CGNAT
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(v4));
            }
            let seg = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || (seg[0] & 0xfe00) == 0xfc00 // fc00::/7 unique-local
                || (seg[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_private_loopback_and_metadata_ips() {
        for ip in [
            "127.0.0.1",
            "127.255.255.254",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254", // cloud metadata
            "169.254.0.1",
            "100.64.0.1",      // CGNAT low edge
            "100.127.255.255", // CGNAT high edge
            "0.0.0.0",
            "0.1.2.3",           // 0.0.0.0/8
            "255.255.255.255",   // broadcast
            "192.0.2.1",         // documentation TEST-NET-1
            "198.51.100.1",      // documentation TEST-NET-2
            "203.0.113.1",       // documentation TEST-NET-3
        ] {
            assert!(
                is_blocked_ip(ip.parse::<IpAddr>().unwrap()),
                "{} should be blocked",
                ip
            );
        }
    }

    #[test]
    fn blocks_internal_ipv6() {
        for ip in [
            "::1",              // loopback
            "::",               // unspecified
            "fe80::1",          // link-local
            "fc00::1",          // unique-local
            "fd12:3456::1",     // unique-local
            "::ffff:127.0.0.1", // v4-mapped loopback
            "::ffff:10.0.0.1",  // v4-mapped private
            "::ffff:169.254.169.254", // v4-mapped metadata
        ] {
            assert!(
                is_blocked_ip(ip.parse::<IpAddr>().unwrap()),
                "{} should be blocked",
                ip
            );
        }
    }

    #[test]
    fn allows_public_ips() {
        for ip in [
            "8.8.8.8",
            "1.1.1.1",
            "100.63.255.255",  // just below CGNAT
            "100.128.0.0",     // just above CGNAT
            "2606:4700:4700::1111",
            "::ffff:8.8.8.8", // v4-mapped public
        ] {
            assert!(
                !is_blocked_ip(ip.parse::<IpAddr>().unwrap()),
                "{} should be allowed",
                ip
            );
        }
    }
}
