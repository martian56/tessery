use base64::Engine;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use uuid::Uuid;

pub const MAIN: &str = "main";
const TESSERY_OWNED: &str = "deploy";
pub const GENERATED: &str = "tessery/generated";
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_PATH_LEN: usize = 300;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("invalid file path `{0}`")]
    InvalidPath(String),
    #[error("invalid ref name `{0}`")]
    InvalidRef(String),
    #[error("the repository does not exist")]
    Missing,
    #[error("generated code conflicts with changes on main in: {}", .0.join(", "))]
    Conflict(Vec<String>),
    #[error("`git {op}` failed: {stderr}")]
    Command { op: String, stderr: String },
    #[error("`git {0}` timed out")]
    Timeout(String),
    #[error("git output was not valid UTF-8")]
    Utf8,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, GitError>;

#[derive(Debug, Clone)]
pub struct Author {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone)]
pub struct Remote {
    pub url: String,
    pub username: Option<String>,
    pub token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChange {
    pub path: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct Repos {
    root: PathBuf,
}

impl Repos {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        let root = data_dir.into();
        Self { root: std::path::absolute(&root).unwrap_or(root) }
    }

    pub fn path(&self, project: Uuid) -> PathBuf {
        self.root.join("repos").join(format!("{project}.git"))
    }

    pub async fn ensure(&self, project: Uuid) -> Result<Repo> {
        let dir = self.path(project);
        let global = self.empty_global_config().await?;
        let repo = Repo { dir: dir.clone(), global };
        if !dir.join("HEAD").exists() {
            tokio::fs::create_dir_all(&dir).await?;
            repo.run(&["init", "--bare", "--quiet", "--initial-branch", MAIN, "."], &[], None).await?;
        }
        Ok(repo)
    }

    pub async fn open(&self, project: Uuid) -> Result<Repo> {
        let dir = self.path(project);
        if !dir.join("HEAD").exists() {
            return Err(GitError::Missing);
        }
        Ok(Repo { dir, global: self.empty_global_config().await? })
    }

    pub async fn remove(&self, project: Uuid) -> Result<()> {
        match tokio::fs::remove_dir_all(self.path(project)).await {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    pub async fn http_backend(&self, project: Uuid, req: HttpRequest<'_>) -> Result<HttpResponse> {
        let global = self.empty_global_config().await?;
        let root = self.root.join("repos");
        let path_info = format!("/{project}.git{}", req.path);
        let mut cmd = Command::new("git");
        cmd.args(["-c", "core.autocrlf=false", "-c", "safe.directory=*", "-c", "core.hooksPath=/dev/null", "-c", "http.receivepack=true", "-c", "http.uploadpack=true", "-c", "receive.denyDeletes=true", "-c", "uploadpack.allowFilter=true", "http-backend"])
            .current_dir(&root)
            .env("GIT_PROJECT_ROOT", &root)
            .env("GIT_HTTP_EXPORT_ALL", "1")
            .env("PATH_INFO", &path_info)
            .env("REQUEST_METHOD", req.method)
            .env("QUERY_STRING", req.query)
            .env("CONTENT_TYPE", req.content_type)
            .env("CONTENT_LENGTH", req.body.len().to_string())
            .env("REMOTE_USER", req.user)
            .env("REMOTE_ADDR", "127.0.0.1")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", &global)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(enc) = req.content_encoding {
            cmd.env("HTTP_CONTENT_ENCODING", enc);
        }
        if let Some(proto) = req.git_protocol {
            cmd.env("GIT_PROTOCOL", proto);
        }
        let mut child = cmd.spawn()?;
        let mut stdin = child.stdin.take().expect("piped");
        let body = req.body.to_vec();
        let writer = tokio::spawn(async move {
            let _ = stdin.write_all(&body).await;
        });
        let out = tokio::time::timeout(Duration::from_secs(600), child.wait_with_output()).await.map_err(|_| GitError::Timeout("http-backend".into()))??;
        let _ = writer.await;
        let split = out.stdout.windows(4).position(|w| w == b"\r\n\r\n").map(|i| (i, 4)).or_else(|| out.stdout.windows(2).position(|w| w == b"\n\n").map(|i| (i, 2)));
        let Some((at, sep)) = split else {
            return Err(GitError::Command { op: "http-backend".into(), stderr: String::from_utf8_lossy(&out.stderr).into_owned() });
        };
        let mut status = 200;
        let mut headers = Vec::new();
        for line in String::from_utf8_lossy(&out.stdout[..at]).lines() {
            let Some((k, v)) = line.split_once(':') else { continue };
            if k.eq_ignore_ascii_case("status") {
                status = v.trim().split(' ').next().and_then(|c| c.parse().ok()).unwrap_or(500);
            } else {
                headers.push((k.trim().to_owned(), v.trim().to_owned()));
            }
        }
        Ok(HttpResponse { status, headers, body: out.stdout[at + sep..].to_vec() })
    }

    async fn empty_global_config(&self) -> Result<PathBuf> {
        let path = self.root.join("gitconfig");
        if !path.exists() {
            tokio::fs::create_dir_all(&self.root).await?;
            tokio::fs::write(&path, b"").await?;
        }
        Ok(path)
    }
}

pub struct HttpRequest<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub content_type: &'a str,
    pub content_encoding: Option<&'a str>,
    pub git_protocol: Option<&'a str>,
    pub user: &'a str,
    pub body: &'a [u8],
}

pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct Repo {
    dir: PathBuf,
    global: PathBuf,
}

impl Repo {
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    async fn write_tree(&self, files: &BTreeMap<String, Vec<u8>>) -> Result<String> {
        for path in files.keys() {
            validate_path(path)?;
        }
        let tmp = tempfile::tempdir()?;
        let work = tmp.path().join("work");
        tokio::fs::create_dir_all(&work).await?;
        for (path, content) in files {
            let target = work.join(path);
            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&target, content).await?;
        }
        let index = tmp.path().join("index");
        let env = [("GIT_WORK_TREE", work.as_os_str()), ("GIT_INDEX_FILE", index.as_os_str())];
        self.run(&["add", "--all", "--force", "."], &env, None).await?;
        Ok(self.run(&["write-tree"], &env, None).await?.trim().to_owned())
    }

    async fn commit_tree(&self, tree: &str, parents: &[&str], message: &str, author: &Author) -> Result<String> {
        let mut args = vec!["commit-tree", tree];
        for p in parents {
            args.extend(["-p", p]);
        }
        let env = [
            ("GIT_AUTHOR_NAME", std::ffi::OsStr::new(&author.name)),
            ("GIT_AUTHOR_EMAIL", std::ffi::OsStr::new(&author.email)),
            ("GIT_COMMITTER_NAME", std::ffi::OsStr::new("Tessery")),
            ("GIT_COMMITTER_EMAIL", std::ffi::OsStr::new("tessery@localhost")),
        ];
        Ok(self.run(&args, &env, Some(message.as_bytes())).await?.trim().to_owned())
    }

    async fn is_ancestor(&self, a: &str, b: &str) -> Result<bool> {
        match self.run(&["merge-base", "--is-ancestor", a, b], &[], None).await {
            Ok(_) => Ok(true),
            Err(GitError::Command { .. }) => Ok(false),
            Err(e) => Err(e),
        }
    }

    pub async fn checkpoint(&self, files: &BTreeMap<String, Vec<u8>>, message: &str, author: &Author) -> Result<String> {
        let gen_ref = format!("refs/heads/{GENERATED}");
        let main_ref = format!("refs/heads/{MAIN}");
        let tree = self.write_tree(files).await?;
        let main = self.resolve(&main_ref).await?;
        let prev = match self.resolve(&gen_ref).await? {
            Some(g) => Some(g),
            None => self.latest_checkpoint_tag().await?,
        };
        let gen_commit = match &prev {
            Some(p) if self.run(&["rev-parse", &format!("{p}^{{tree}}")], &[], None).await?.trim() == tree => p.clone(),
            Some(p) => self.commit_tree(&tree, &[p], message, author).await?,
            None => self.commit_tree(&tree, &[], message, author).await?,
        };

        let next = match &main {
            None => gen_commit.clone(),
            Some(m) if Some(m) == prev.as_ref() => gen_commit.clone(),
            Some(m) if self.is_ancestor(&gen_commit, m).await? => m.clone(),
            Some(m) => {
                let merged = self.run_status(&["merge-tree", "--write-tree", "--name-only", "--no-messages", m, &gen_commit]).await?;
                let mut lines = merged.1.lines();
                let tree = lines.next().unwrap_or_default().trim().to_owned();
                if merged.0 != 0 {
                    let conflicted: Vec<String> = lines.map(str::trim).filter(|l| !l.is_empty() && !l.starts_with(&format!("{TESSERY_OWNED}/"))).map(str::to_owned).collect();
                    if tree.is_empty() {
                        return Err(GitError::Command { op: "merge-tree".into(), stderr: merged.1 });
                    }
                    if !conflicted.is_empty() {
                        return Err(GitError::Conflict(conflicted));
                    }
                }
                let tree = self.with_generated_dir(&tree, &gen_commit, TESSERY_OWNED).await?;
                self.commit_tree(&tree, &[m, &gen_commit], message, author).await?
            }
        };
        let zero = "0000000000000000000000000000000000000000";
        if prev.as_deref() != Some(gen_commit.as_str()) || self.resolve(&gen_ref).await?.is_none() {
            let old = self.resolve(&gen_ref).await?;
            self.run(&["update-ref", &gen_ref, &gen_commit, old.as_deref().unwrap_or(zero)], &[], None).await?;
        }
        if main.as_deref() != Some(next.as_str()) {
            self.run(&["update-ref", &main_ref, &next, main.as_deref().unwrap_or(zero)], &[], None).await?;
        }
        Ok(next)
    }

    async fn with_generated_dir(&self, tree: &str, generated: &str, dir: &str) -> Result<String> {
        let ours = self.run(&["ls-tree", "-r", "--full-tree", tree], &[], None).await?;
        let theirs = self.run(&["ls-tree", "-r", "--full-tree", generated, "--", dir], &[], None).await?;
        let prefix = format!("{dir}/");
        let mut entries: String = ours.lines().filter(|l| !l.split_once('\t').is_some_and(|(_, path)| path.starts_with(&prefix))).map(|l| format!("{l}\n")).collect();
        entries.extend(theirs.lines().map(|l| format!("{l}\n")));
        let tmp = tempfile::tempdir()?;
        let index = tmp.path().join("index");
        let env = [("GIT_INDEX_FILE", index.as_os_str())];
        self.run(&["update-index", "--index-info"], &env, Some(entries.as_bytes())).await?;
        Ok(self.run(&["write-tree"], &env, None).await?.trim().to_owned())
    }

    async fn latest_checkpoint_tag(&self) -> Result<Option<String>> {
        let out = self.run(&["for-each-ref", "--format=%(refname:strip=2) %(objectname)", "refs/tags/checkpoint/"], &[], None).await?;
        Ok(out
            .lines()
            .filter_map(|l| {
                let (name, sha) = l.split_once(' ')?;
                Some((name.strip_prefix("checkpoint/")?.parse::<u64>().ok()?, sha.to_owned()))
            })
            .max_by_key(|(n, _)| *n)
            .map(|(_, sha)| sha))
    }

    async fn run_status(&self, args: &[&str]) -> Result<(i32, String)> {
        let out = Command::new("git")
            .args(["-c", "core.autocrlf=false", "-c", "safe.directory=*", "-c", "core.hooksPath=/dev/null"])
            .args(args)
            .current_dir(&self.dir)
            .env("GIT_DIR", &self.dir)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", &self.global)
            .stdin(Stdio::null())
            .output()
            .await?;
        Ok((out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).into_owned()))
    }

    pub async fn tag(&self, name: &str, commit: &str) -> Result<()> {
        validate_ref(name)?;
        self.run(&["update-ref", &format!("refs/tags/{name}"), commit, ""], &[], None).await.map(drop)
    }

    pub async fn set_branch(&self, branch: &str, commit: &str) -> Result<()> {
        validate_ref(branch)?;
        self.run(&["update-ref", &format!("refs/heads/{branch}"), commit], &[], None).await.map(drop)
    }

    pub async fn sync_refs(&self, branches: &[(String, String)], tags: &[(String, String)]) -> Result<()> {
        for (name, commit) in branches {
            if self.resolve(&format!("refs/heads/{name}")).await?.as_deref() != Some(commit.as_str()) {
                self.set_branch(name, commit).await?;
            }
        }
        for (name, commit) in tags {
            if self.resolve(&format!("refs/tags/{name}")).await?.is_none() {
                self.tag(name, commit).await?;
            }
        }
        Ok(())
    }

    pub async fn resolve(&self, rev: &str) -> Result<Option<String>> {
        match self.run(&["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")], &[], None).await {
            Ok(out) => Ok(Some(out.trim().to_owned())),
            Err(GitError::Command { .. }) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub async fn read_file(&self, commit: &str, path: &str) -> Result<Vec<u8>> {
        validate_path(path)?;
        self.run_bytes(&["cat-file", "blob", &format!("{commit}:{path}")], &[], None).await
    }

    pub async fn read_file_if_exists(&self, commit: &str, path: &str) -> Result<Option<Vec<u8>>> {
        validate_path(path)?;
        if self.run_status(&["cat-file", "-e", &format!("{commit}:{path}")]).await?.0 != 0 {
            return Ok(None);
        }
        self.read_file(commit, path).await.map(Some)
    }

    pub async fn archive(&self, commit: &str) -> Result<Vec<u8>> {
        if !commit.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(GitError::InvalidRef(commit.to_owned()));
        }
        self.run_bytes(&["archive", "--format=tar", commit], &[], None).await
    }

    pub async fn diff(&self, from: Option<&str>, to: &str) -> Result<Vec<FileChange>> {
        let out = self
            .run(&["diff-tree", "-r", "--no-renames", "--numstat", "-z", from.unwrap_or(EMPTY_TREE), to], &[], None)
            .await?;
        Ok(parse_numstat(&out))
    }

    pub async fn bundle(&self) -> Result<Vec<u8>> {
        if self.resolve(&format!("refs/heads/{MAIN}")).await?.is_none() {
            return Err(GitError::Missing);
        }
        let tmp = tempfile::tempdir()?;
        let file = tmp.path().join("repo.bundle");
        let file_arg = file.to_string_lossy().into_owned();
        self.run(&["bundle", "create", "--quiet", &file_arg, "--all"], &[], None).await?;
        Ok(tokio::fs::read(&file).await?)
    }

    pub async fn push(&self, remote: &Remote) -> Result<()> {
        let mut env: Vec<(String, String)> = Vec::new();
        if let Some(token) = remote.token.as_deref().filter(|t| !t.is_empty()) {
            let user = remote.username.as_deref().filter(|u| !u.is_empty()).unwrap_or("x-access-token");
            let basic = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{token}"));
            env.extend([
                ("GIT_CONFIG_COUNT".into(), "1".into()),
                ("GIT_CONFIG_KEY_0".into(), "http.extraHeader".into()),
                ("GIT_CONFIG_VALUE_0".into(), format!("Authorization: Basic {basic}")),
            ]);
        }
        let env_ref: Vec<(&str, &std::ffi::OsStr)> = env.iter().map(|(k, v)| (k.as_str(), std::ffi::OsStr::new(v))).collect();
        self.run(&["push", "--porcelain", &remote.url, "+refs/heads/*:refs/heads/*", "refs/tags/*:refs/tags/*"], &env_ref, None)
            .await
            .map(drop)
    }

    async fn run(&self, args: &[&str], env: &[(&str, &std::ffi::OsStr)], stdin: Option<&[u8]>) -> Result<String> {
        String::from_utf8(self.run_bytes(args, env, stdin).await?).map_err(|_| GitError::Utf8)
    }

    async fn run_bytes(&self, args: &[&str], env: &[(&str, &std::ffi::OsStr)], stdin: Option<&[u8]>) -> Result<Vec<u8>> {
        let op = args.first().copied().unwrap_or_default().to_owned();
        let mut cmd = Command::new("git");
        cmd.args(["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.quotepath=off", "-c", "safe.directory=*", "-c", "core.hooksPath=/dev/null"])
            .args(args)
            .current_dir(&self.dir)
            .env("GIT_DIR", &self.dir)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", &self.global)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env_remove("GIT_ASKPASS")
            .env_remove("SSH_ASKPASS")
            .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (k, v) in env {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn()?;
        if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
            pipe.write_all(input).await?;
            drop(pipe);
        }
        let out = tokio::time::timeout(COMMAND_TIMEOUT, child.wait_with_output())
            .await
            .map_err(|_| GitError::Timeout(op.clone()))??;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_owned();
            tracing::debug!(%op, %stderr, "git command failed");
            return Err(GitError::Command { op, stderr });
        }
        Ok(out.stdout)
    }
}

pub fn validate_path(path: &str) -> Result<()> {
    let bad = path.is_empty()
        || path.len() > MAX_PATH_LEN
        || path.starts_with('/')
        || path.contains(['\\', ':', '\0'])
        || path.chars().any(char::is_control)
        || path.split('/').any(|seg| seg.is_empty() || seg == "." || seg == ".." || seg.eq_ignore_ascii_case(".git"));
    if bad { Err(GitError::InvalidPath(path.to_owned())) } else { Ok(()) }
}

fn validate_ref(name: &str) -> Result<()> {
    let ok = !name.is_empty()
        && name.len() <= 200
        && name.split('/').all(|seg| !seg.is_empty() && !seg.starts_with('.') && !seg.ends_with(".lock"))
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
        && !name.contains("..");
    if ok { Ok(()) } else { Err(GitError::InvalidRef(name.to_owned())) }
}

fn parse_numstat(out: &str) -> Vec<FileChange> {
    out.split('\0')
        .filter(|rec| !rec.is_empty())
        .filter_map(|rec| {
            let mut parts = rec.splitn(3, '\t');
            let added = parts.next()?;
            let removed = parts.next()?;
            let path = parts.next()?.trim_start_matches('\n');
            Some(FileChange { path: path.to_owned(), added: added.parse().ok(), removed: removed.parse().ok() })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(pairs: &[(&str, &str)]) -> BTreeMap<String, Vec<u8>> {
        pairs.iter().map(|(p, c)| ((*p).to_owned(), c.as_bytes().to_vec())).collect()
    }

    fn author() -> Author {
        Author { name: "Test".into(), email: "test@example.com".into() }
    }

    #[test]
    fn rejects_paths_that_escape_or_touch_metadata() {
        for bad in ["", "/etc/passwd", "../x", "a/../b", "a//b", ".git/config", "src/.GIT/x", "c:\\x", "a\\b", "a/./b"] {
            assert!(validate_path(bad).is_err(), "{bad}");
        }
        for good in ["tessery.json", "services/api/src/main.rs", ".github/workflows/deploy.yml"] {
            assert!(validate_path(good).is_ok(), "{good}");
        }
    }

    #[tokio::test]
    async fn works_with_a_relative_data_dir() {
        let rel = format!("target/tessery-git-test-{}", Uuid::now_v7());
        let repos = Repos::new(&rel);
        let id = Uuid::now_v7();
        let repo = repos.ensure(id).await.unwrap();
        repo.checkpoint(&files(&[("a.txt", "a")]), "one", &author()).await.unwrap();
        tokio::fs::remove_dir_all(&rel).await.unwrap();
    }

    #[test]
    fn parses_numstat_records() {
        let out = "3\t1\ta.txt\0-\t-\timg.png\0";
        assert_eq!(parse_numstat(out), vec![
            FileChange { path: "a.txt".into(), added: Some(3), removed: Some(1) },
            FileChange { path: "img.png".into(), added: None, removed: None },
        ]);
    }

    #[tokio::test]
    async fn snapshots_branches_bundles_and_pushes() {
        let data = tempfile::tempdir().unwrap();
        let repos = Repos::new(data.path());
        let id = Uuid::now_v7();
        let repo = repos.ensure(id).await.unwrap();

        let c1 = repo.checkpoint(&files(&[("tessery.json", "{}\r\n"), ("old.txt", "x")]), "first", &author()).await.unwrap();
        let c2 = repo.checkpoint(&files(&[("tessery.json", "{\"a\":1}\n"), ("src/new.ts", "y\n")]), "second", &author()).await.unwrap();
        assert_ne!(c1, c2);

        assert_eq!(repo.read_file(&c1, "tessery.json").await.unwrap(), b"{}\r\n", "line endings are kept as given");
        assert!(repo.read_file(&c2, "old.txt").await.is_err(), "files missing from a snapshot are deleted");

        let mut changes = repo.diff(Some(&c1), &c2).await.unwrap();
        changes.sort_by(|a, b| a.path.cmp(&b.path));
        let paths: Vec<_> = changes.iter().map(|c| c.path.as_str()).collect();
        assert_eq!(paths, ["old.txt", "src/new.ts", "tessery.json"]);

        repo.tag("checkpoint/1", &c1).await.unwrap();
        assert!(repo.tag("checkpoint/1", &c2).await.is_err(), "tags never move");
        repo.set_branch("env/dev", &c2).await.unwrap();
        repo.set_branch("env/dev", &c1).await.unwrap();
        assert_eq!(repo.resolve("refs/heads/env/dev").await.unwrap().as_deref(), Some(c1.as_str()));
        assert!(repo.set_branch("env/../x", &c1).await.is_err());

        assert!(!repo.bundle().await.unwrap().is_empty());

        let remote_dir = data.path().join("remote.git");
        let init = Command::new("git").args(["init", "--bare", "--quiet"]).arg(&remote_dir).status().await.unwrap();
        assert!(init.success());
        let url = remote_dir.to_string_lossy().replace('\\', "/");
        repo.push(&Remote { url: url.clone(), username: None, token: None }).await.unwrap();
        let out = Command::new("git").args(["--git-dir", &url, "rev-parse", "refs/heads/env/dev", "refs/heads/main", "refs/tags/checkpoint/1"]).output().await.unwrap();
        let refs = String::from_utf8(out.stdout).unwrap();
        assert_eq!(refs.lines().collect::<Vec<_>>(), [c1.as_str(), c2.as_str(), c1.as_str()]);

        repos.remove(id).await.unwrap();
        assert!(matches!(repos.open(id).await, Err(GitError::Missing)));
    }

    async fn developer_commit(repo: &Repo, path: &str, content: &str) -> String {
        let main = repo.resolve("refs/heads/main").await.unwrap().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let index = tmp.path().join("index");
        let env = [("GIT_INDEX_FILE", index.as_os_str())];
        repo.run(&["read-tree", &main], &env, None).await.unwrap();
        let blob = repo.run(&["hash-object", "-w", "--stdin"], &[], Some(content.as_bytes())).await.unwrap();
        repo.run(&["update-index", "--add", "--cacheinfo", &format!("100644,{},{path}", blob.trim())], &env, None).await.unwrap();
        let tree = repo.run(&["write-tree"], &env, None).await.unwrap();
        let commit = repo.commit_tree(tree.trim(), &[&main], "developer change", &author()).await.unwrap();
        repo.run(&["update-ref", "refs/heads/main", &commit, &main], &[], None).await.unwrap();
        commit
    }

    #[tokio::test]
    async fn checkpoints_merge_generated_code_with_developer_changes() {
        let data = tempfile::tempdir().unwrap();
        let repos = Repos::new(data.path());
        let repo = repos.ensure(Uuid::now_v7()).await.unwrap();
        let routes = "line 1\nline 2\nline 3\nline 4\nline 5\n";

        let c1 = repo.checkpoint(&files(&[("tessery.json", "{}\n"), ("src/routes.ts", routes), ("src/old.ts", "old\n")]), "first", &author()).await.unwrap();
        developer_commit(&repo, "src/routes.ts", "line 1\nline 2 written by hand\nline 3\nline 4\nline 5\n").await;
        developer_commit(&repo, "src/extra.ts", "mine\n").await;

        let c2 = repo
            .checkpoint(&files(&[("tessery.json", "{\"v\":2}\n"), ("src/routes.ts", "line 1\nline 2\nline 3\nline 4\nline 5 regenerated\n"), ("src/new.ts", "new\n")]), "second", &author())
            .await
            .unwrap();
        let read = |c: String, path: &'static str| { let r = repo.clone(); async move { String::from_utf8(r.read_file(&c, path).await.unwrap()).unwrap() } };
        assert_eq!(read(c2.clone(), "src/routes.ts").await, "line 1\nline 2 written by hand\nline 3\nline 4\nline 5 regenerated\n", "both sides land");
        assert_eq!(read(c2.clone(), "src/extra.ts").await, "mine\n", "developer files are kept");
        assert_eq!(read(c2.clone(), "src/new.ts").await, "new\n");
        assert!(repo.read_file(&c2, "src/old.ts").await.is_err(), "files the design no longer generates are removed");
        assert!(repo.is_ancestor(&c1, &c2).await.unwrap());

        let same = repo.checkpoint(&files(&[("tessery.json", "{\"v\":2}\n"), ("src/routes.ts", "line 1\nline 2\nline 3\nline 4\nline 5 regenerated\n"), ("src/new.ts", "new\n")]), "again", &author()).await.unwrap();
        assert_eq!(same, c2, "nothing new to merge keeps main where it is");

        let legacy = repos.ensure(Uuid::now_v7()).await.unwrap();
        let first = legacy.checkpoint(&files(&[("a.ts", "generated\n")]), "first", &author()).await.unwrap();
        legacy.tag("checkpoint/1", &first).await.unwrap();
        legacy.run(&["update-ref", "-d", "refs/heads/tessery/generated"], &[], None).await.unwrap();
        developer_commit(&legacy, "mine.ts", "kept\n").await;
        let next = legacy.checkpoint(&files(&[("a.ts", "generated again\n")]), "second", &author()).await.unwrap();
        assert_eq!(legacy.read_file(&next, "mine.ts").await.unwrap(), b"kept\n", "repositories without the generated branch keep pushes made after their last checkpoint");

        developer_commit(&repo, "deploy/dev/compose.yaml", "services: { evil: { privileged: true } }\n").await;
        let guarded = repo.checkpoint(&files(&[("tessery.json", "{\"v\":2}\n"), ("src/routes.ts", "line 1\nline 2\nline 3\nline 4\nline 5 regenerated\n"), ("src/new.ts", "new\n"), ("deploy/dev/compose.yaml", "services: {}\n")]), "deploy", &author()).await.unwrap();
        assert_eq!(repo.read_file(&guarded, "deploy/dev/compose.yaml").await.unwrap(), b"services: {}\n", "deploy files always come from Tessery");
        assert_eq!(repo.read_file(&guarded, "src/extra.ts").await.unwrap(), b"mine\n");

        developer_commit(&repo, "src/new.ts", "edited by hand\n").await;
        let err = repo.checkpoint(&files(&[("tessery.json", "{\"v\":3}\n"), ("src/routes.ts", routes), ("src/new.ts", "regenerated differently\n")]), "third", &author()).await.unwrap_err();
        assert!(matches!(&err, GitError::Conflict(f) if f == &vec!["src/new.ts".to_owned()]), "{err}");
    }
}
