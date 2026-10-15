//! Resource admission shared with `/root/bin/provider-agent-run.sh`: a 6 GiB
//! MemAvailable floor and the same host slot files under
//! `/run/lock/lakeside-external-agents/host`, so Rust-launched and
//! shell-launched workers count against one cap.

use std::fs::{File, OpenOptions};
use std::os::fd::AsRawFd;
use std::path::PathBuf;

pub const MIN_AVAILABLE_KIB: u64 = 6 * 1024 * 1024;
pub const HOST_LIMIT: u32 = 8;

pub fn mem_available_kib() -> u64 {
    std::fs::read_to_string("/proc/meminfo").ok().and_then(|t| t.lines().find(|l| l.starts_with("MemAvailable:")).and_then(|l| l.split_whitespace().nth(1)).and_then(|n| n.parse().ok())).unwrap_or(0)
}

pub struct HostSlot { _file: File, pub number: u32 }

#[derive(Debug, thiserror::Error)]
pub enum AdmissionError {
    #[error("resource admission refused: MemAvailable {0} KiB is below the 6 GiB floor")] Memory(u64),
    #[error("resource admission refused: all {0} host worker slots are occupied")] Slots(u32),
    #[error("slot directory: {0}")] Io(#[from] std::io::Error),
}

/// Take one host slot with a non-blocking flock; released on drop.
pub fn admit(slot_dir: Option<PathBuf>) -> Result<HostSlot, AdmissionError> {
    admit_with_memory(slot_dir, mem_available_kib())
}

fn admit_with_memory(slot_dir: Option<PathBuf>, mem: u64) -> Result<HostSlot, AdmissionError> {
    if mem < MIN_AVAILABLE_KIB { return Err(AdmissionError::Memory(mem)); }
    let dir = slot_dir.unwrap_or_else(|| std::env::var_os("LAKESIDE_SLOT_DIR").map(PathBuf::from).unwrap_or_else(|| {
        let home = crate::spawn::user_home();
        if home == std::path::Path::new("/root") { PathBuf::from("/run/lock/lakeside-external-agents/host") }
        else { home.join(".local/state/lakeside/slots") }
    }));
    std::fs::create_dir_all(&dir)?;
    for n in 1..=HOST_LIMIT {
        let f = OpenOptions::new().create(true).write(true).open(dir.join(format!("slot-{n}.lock")))?;
        // SAFETY: flock on a valid, open file descriptor we own for the slot's lifetime.
        let rc = unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if rc == 0 { return Ok(HostSlot { _file: f, number: n }); }
    }
    Err(AdmissionError::Slots(HOST_LIMIT))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slots_are_exclusive_and_released_on_drop() {
        let dir = std::env::temp_dir().join(format!("slots-{}", std::process::id()));
        let mut held = Vec::new();
        for i in 1..=HOST_LIMIT { let s = admit_with_memory(Some(dir.clone()), MIN_AVAILABLE_KIB).unwrap(); assert_eq!(s.number, i); held.push(s); }
        assert!(matches!(admit_with_memory(Some(dir.clone()), MIN_AVAILABLE_KIB), Err(AdmissionError::Slots(_))));
        drop(held);
        assert_eq!(admit_with_memory(Some(dir.clone()), MIN_AVAILABLE_KIB).unwrap().number, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
