pub fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut dash = false;
    for c in input.trim().chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out.truncate(48);
    out.trim_end_matches('-').to_owned()
}

pub fn is_valid(slug: &str) -> bool {
    !slug.is_empty() && slug.len() <= 48 && slugify(slug) == slug
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugifies() {
        assert_eq!(slugify("  Acme Corp, Inc. "), "acme-corp-inc");
        assert_eq!(slugify("Über--Team"), "ber-team");
        assert_eq!(slugify("---"), "");
        assert!(is_valid("platform-team"));
        assert!(!is_valid("Platform"));
        assert!(!is_valid("a--b"));
    }
}
