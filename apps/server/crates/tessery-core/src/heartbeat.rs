use std::time::Duration;

/// Redis key that the worker refreshes while it is alive.
pub const WORKER_HEARTBEAT_KEY: &str = "tessery:worker:heartbeat";

/// How often the worker refreshes its heartbeat.
pub const WORKER_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(3);

/// How long the key lives without a refresh. A few missed beats and it is gone.
pub const WORKER_HEARTBEAT_TTL_SECS: u64 = 10;
