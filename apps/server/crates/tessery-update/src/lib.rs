//! Finding Tessery releases and updating a self-hosted instance to one of them.
//!
//! The server and the worker run inside the containers they would replace, so an update is done by a separate,
//! short-lived updater container that pulls the new images and recreates the `server` and `worker` services.

mod github;
mod updater;
mod version;

pub use github::{Release, fetch_latest, fetch_releases};
pub use updater::{UpdateError, Updater};
pub use version::{is_newer, is_version};

/// Where the latest release is read from; the list of releases is the same address without `/latest`.
pub const RELEASES_URL: &str = "https://api.github.com/repos/martian56/tessery/releases/latest";

/// The version this build runs, from `TESSERY_VERSION`; `dev` when built without one.
pub fn current_version() -> String {
    std::env::var("TESSERY_VERSION").ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| "dev".into())
}

/// Where releases are looked up, from `TESSERY_RELEASES_URL`.
pub fn releases_url_from_env() -> String {
    std::env::var("TESSERY_RELEASES_URL").ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| RELEASES_URL.into())
}

/// Whether `hour` (UTC, 0 to 23) falls in the daily window from `from` up to, not including, `to`. A window whose end
/// comes before its start runs past midnight, and one whose start equals its end covers the whole day.
pub fn in_window(hour: u8, from: u8, to: u8) -> bool {
    match from.cmp(&to) {
        std::cmp::Ordering::Equal => true,
        std::cmp::Ordering::Less => (from..to).contains(&hour),
        std::cmp::Ordering::Greater => hour >= from || hour < to,
    }
}

#[cfg(test)]
mod tests {
    use super::{in_window, is_newer};

    #[test]
    fn windows_can_run_past_midnight() {
        assert!(in_window(3, 3, 5) && in_window(4, 3, 5) && !in_window(5, 3, 5) && !in_window(2, 3, 5));
        assert!(in_window(23, 22, 2) && in_window(1, 22, 2) && !in_window(2, 22, 2) && !in_window(12, 22, 2));
        assert!(in_window(17, 4, 4));
    }

    #[test]
    fn compares_versions_as_numbers() {
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(!is_newer("0.2.0", "0.2.0"));
        assert!(!is_newer("0.1.9", "0.2.0"));
        assert!(is_newer("0.2.0", "0.2.0-rc.1"), "a release is newer than its pre-release");
        assert!(!is_newer("0.2.0-rc.1", "0.2.0"));
        assert!(is_newer("0.2.0-rc.10", "0.2.0-rc.2"), "pre-release numbers compare as numbers");
        assert!(!is_newer("0.2.0-rc.2", "0.2.0-rc.10"));
        assert!(!is_newer("0.2.0", "dev"));
        assert!(!is_newer("main", "0.1.0"));
    }
}
