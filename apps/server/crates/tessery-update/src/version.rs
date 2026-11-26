use std::cmp::Ordering;

/// `major.minor.patch` with an optional `-pre` suffix; anything else (such as `dev`) is not a version.
fn parse(v: &str) -> Option<([u64; 3], Option<&str>)> {
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (v, None),
    };
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let n = [parts.next()??, parts.next()??, parts.next()??];
    if parts.next().is_some()
        || pre.is_some_and(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_alphanumeric() || c == '.'))
    {
        return None;
    }
    Some((n, pre))
}

pub fn is_version(v: &str) -> bool {
    parse(v).is_some()
}

/// Whether `latest` is a later version than `current`. A pre-release sorts before its release, and a build
/// without a version never reports an update.
pub fn is_newer(latest: &str, current: &str) -> bool {
    let (Some((l, lp)), Some((c, cp))) = (parse(latest), parse(current)) else {
        return false;
    };
    match l.cmp(&c) {
        Ordering::Greater => true,
        Ordering::Less => false,
        Ordering::Equal => match (lp, cp) {
            (None, Some(_)) => true,
            (Some(a), Some(b)) => pre_release_order(a, b).is_gt(),
            _ => false,
        },
    }
}

/// Orders pre-release labels by their dot-separated parts, numbers as numbers: `rc.10` comes after `rc.2`.
fn pre_release_order(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a.split('.'), b.split('.'));
    loop {
        let ord = match (x.next(), y.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(p), Some(q)) => match (p.parse::<u64>(), q.parse::<u64>()) {
                (Ok(m), Ok(n)) => m.cmp(&n),
                (Ok(_), Err(_)) => Ordering::Less,
                (Err(_), Ok(_)) => Ordering::Greater,
                (Err(_), Err(_)) => p.cmp(q),
            },
        };
        if ord.is_ne() {
            return ord;
        }
    }
}
