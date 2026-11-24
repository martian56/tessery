use tokio::process::Command;

const CONTAINER: &str = "tessery-updater";

/// Pins the target version in `.env`, so a later `docker compose up -d` keeps it, then recreates only the app
/// services. Postgres, Redis, RabbitMQ, object storage and Caddy keep running, and the server applies any new
/// migrations when it starts.
const SCRIPT: &str = r#"set -eu
cd "$TESSERY_COMPOSE_DIR"
touch .env
if grep -q '^TESSERY_IMAGE_TAG=' .env; then
  sed -i "s|^TESSERY_IMAGE_TAG=.*|TESSERY_IMAGE_TAG=$TESSERY_TARGET|" .env
else
  echo "TESSERY_IMAGE_TAG=$TESSERY_TARGET" >> .env
fi
echo "moving Tessery to $TESSERY_TARGET"
docker compose pull server worker
docker compose up -d server worker
echo "Tessery is on $TESSERY_TARGET"
"#;

#[derive(Debug, thiserror::Error)]
pub enum UpdateError {
    #[error("in-app updates are turned off: set TESSERY_COMPOSE_DIR to the folder with Tessery's compose.yml and .env")]
    Disabled,
    #[error("an update is already running; follow it with `docker logs -f tessery-updater` on the host")]
    AlreadyRunning,
    #[error("{0} is not a version such as 0.2.0")]
    BadVersion(String),
    #[error("could not start the updater: {0}")]
    Failed(String),
}

/// Starts updater containers through the Docker socket the server and worker already have.
#[derive(Debug, Clone)]
pub struct Updater {
    /// The host folder with Tessery's `compose.yml` and `.env`. Unset turns in-app updates off.
    pub compose_dir: Option<String>,
    /// An image with the Docker CLI and its compose plugin.
    pub image: String,
    pub docker: String,
}

impl Updater {
    pub fn from_env() -> Self {
        let get = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        Self {
            compose_dir: get("TESSERY_COMPOSE_DIR"),
            image: get("TESSERY_UPDATER_IMAGE").unwrap_or_else(|| "docker:28-cli".into()),
            docker: get("TESSERY_DOCKER_BIN").unwrap_or_else(|| "docker".into()),
        }
    }

    pub fn enabled(&self) -> bool {
        self.compose_dir.is_some()
    }

    /// Starts a detached updater container that moves the instance to `target`. It returns once the container is
    /// running; the update itself then replaces this process.
    pub async fn start(&self, target: &str) -> Result<(), UpdateError> {
        let dir = self.compose_dir.as_deref().ok_or(UpdateError::Disabled)?;
        if !crate::is_version(target) {
            return Err(UpdateError::BadVersion(target.to_owned()));
        }
        match self.docker(&["inspect", "--format", "{{.State.Running}}", CONTAINER]).await {
            Ok(out) if out.trim() == "true" => return Err(UpdateError::AlreadyRunning),
            // The last updater's container is kept for its log until the next update replaces it.
            Ok(_) => {
                self.docker(&["rm", CONTAINER]).await?;
            }
            Err(_) => {}
        }
        let mount = format!("{dir}:{dir}");
        let env_dir = format!("TESSERY_COMPOSE_DIR={dir}");
        let env_target = format!("TESSERY_TARGET={target}");
        self.docker(&[
            "run", "--detach", "--name", CONTAINER, "--label", "tessery.updater=true",
            "--volume", "/var/run/docker.sock:/var/run/docker.sock", "--volume", &mount, "--workdir", dir,
            "--env", &env_dir, "--env", &env_target, &self.image, "sh", "-c", SCRIPT,
        ])
        .await?;
        tracing::info!(target, "started the updater");
        Ok(())
    }

    async fn docker(&self, args: &[&str]) -> Result<String, UpdateError> {
        let out = Command::new(&self.docker).args(args).output().await.map_err(|e| UpdateError::Failed(e.to_string()))?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        } else {
            Err(UpdateError::Failed(String::from_utf8_lossy(&out.stderr).trim().to_owned()))
        }
    }
}
