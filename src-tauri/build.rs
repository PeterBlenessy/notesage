fn main() {
    // On non-macOS hosts (e.g. Linux CI or dev), create a sidecar placeholder so
    // tauri_build doesn't fail looking for `llama-server-<triple>`.  The real
    // binary is only bundled for macOS targets.
    #[cfg(not(target_os = "macos"))]
    {
        let triple = std::env::var("TARGET").unwrap_or_else(|_| {
            // Fallback: read the host triple from rustc
            let output = std::process::Command::new("rustc")
                .arg("-vV")
                .output()
                .expect("rustc must be installed");
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout
                .lines()
                .find_map(|l| l.strip_prefix("host: "))
                .unwrap_or("x86_64-unknown-linux-gnu")
                .to_string()
        });
        let placeholder = std::path::PathBuf::from("binaries")
            .join(format!("llama-server-{triple}"));
        if !placeholder.exists() {
            std::fs::create_dir_all("binaries").ok();
            std::fs::write(&placeholder, "#!/bin/sh\nexit 1\n").ok();
            // Make executable on Unix
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&placeholder, std::fs::Permissions::from_mode(0o755))
                    .ok();
            }
        }
    }

    tauri_build::build()
}
