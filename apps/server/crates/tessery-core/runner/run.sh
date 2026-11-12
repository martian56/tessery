#!/bin/sh
set -eu
cd /work

plan="deploy/$TESSERY_ENV/plan.json"
if [ ! -f "$plan" ]; then
  echo "This checkpoint has no deploy plan for $TESSERY_ENV. Create a new checkpoint and try again."
  exit 2
fi
kind=$(jq -r .target.kind "$plan")
project=$(jq -r .project "$plan")
stack=$(printf '%s-%s' "$project" "$TESSERY_ENV" | tr 'A-Z.' 'a-z-')
secrets=/work/.tessery/secrets.env
compose_env=/work/.tessery/compose.env
export BUILDKIT_PROGRESS=plain

step() { echo "::step::$*"; }

build() {
  prefix=$1
  jq -r '.builds[] | "\(.name) \(.context)"' "$plan" | while read -r name ctx; do
    step "Building $name"
    docker build -t "$prefix$name:$TESSERY_TAG" "$ctx"
    if [ "${2:-}" = push ]; then
      step "Pushing $name"
      docker push "$prefix$name:$TESSERY_TAG"
    fi
  done
}

prune_images() {
  prefix=$1
  jq -r '.builds[].name' "$plan" | while read -r name; do
    docker images "$prefix$name" --format '{{.CreatedAt}}|{{.Tag}}' | sort -r | tail -n +4 | cut -d'|' -f2 | while read -r tag; do
      docker rmi "$prefix$name:$tag" >/dev/null 2>&1 || true
    done
  done
}

check_http() {
  network=$1
  checks=$(jq -r '.checks[]? | "\(.name) \(.port) \(.path)"' "$plan")
  [ -n "$checks" ] || return 0
  me=$(hostname)
  docker network connect "$network" "$me" >/dev/null 2>&1 || true
  echo "$checks" | while read -r name port path; do
    step "Checking $name"
    i=0
    until curl -fsS -o /dev/null --max-time 3 "http://$name:$port$path"; do
      i=$((i + 1))
      if [ "$i" -ge 60 ]; then
        echo "$name did not answer http://$name:$port$path after 2 minutes. Its last log lines:"
        docker compose -p "$stack" logs --tail 40 "$name" || true
        exit 1
      fi
      sleep 2
    done
    echo "$name is healthy"
  done
  docker network disconnect "$network" "$me" >/dev/null 2>&1 || true
}

use_docker_host() {
  host=$(jq -r '.target.host // empty' "$plan")
  [ -n "$host" ] || return 0
  export DOCKER_HOST="$host"
  case "$host" in ssh://*) ;; *) return 0 ;; esac
  if [ ! -s /work/.tessery/ssh_key ]; then
    echo "$host needs the SSH_PRIVATE_KEY secret. Add it under the environment's secrets."
    exit 2
  fi
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  cp /work/.tessery/ssh_key ~/.ssh/id_tessery && chmod 600 ~/.ssh/id_tessery
  check=accept-new
  if [ -s /work/.tessery/known_hosts ]; then
    cp /work/.tessery/known_hosts ~/.ssh/known_hosts
    check=yes
  fi
  cat > ~/.ssh/config <<EOF
Host *
  IdentityFile ~/.ssh/id_tessery
  IdentitiesOnly yes
  StrictHostKeyChecking $check
  ServerAliveInterval 30
  ConnectTimeout 15
EOF
  step "Connecting to $host"
  if ! docker version --format 'Docker {{.Server.Version}} on the remote host' 2>&1; then
    echo "Could not reach Docker at $host. Check the address, that the key's user may run docker, and that sshd allows it."
    exit 1
  fi
  if [ "$check" = accept-new ]; then
    echo "Host key trusted on first use. Pin it by saving this as the SSH_KNOWN_HOSTS secret:"
    cat ~/.ssh/known_hosts
  fi
}

action=${TESSERY_ACTION:-deploy}
if [ "$action" != deploy ]; then
  case "$kind" in
    docker)
      use_docker_host
      if [ "$action" = destroy ]; then
        step "Removing $stack and its data"
        docker compose -p "$stack" down --volumes --remove-orphans
        docker images --format '{{.Repository}}:{{.Tag}}' | grep "^tessery/$project/" | xargs -r docker rmi -f >/dev/null 2>&1 || true
      else
        step "Stopping $stack (data is kept)"
        docker compose -p "$stack" down --remove-orphans
      fi
      ;;
    kubernetes)
      export KUBECONFIG=/work/.tessery/kubeconfig
      ns=$(jq -r .namespace "$plan")
      if [ "$action" = destroy ]; then
        step "Deleting namespace $ns"
        kubectl delete namespace "$ns" --ignore-not-found --wait=false
      else
        step "Scaling $ns to zero (volumes are kept)"
        kubectl -n "$ns" scale deployment,statefulset --all --replicas=0
      fi
      ;;
  esac
  step "Done"
  exit 0
fi

case "$kind" in
  docker)
    use_docker_host
    export TESSERY_IMAGE_PREFIX="tessery/$project/" TESSERY_TAG
    build "$TESSERY_IMAGE_PREFIX"
    step "Starting $stack"
    docker compose -p "$stack" -f "deploy/$TESSERY_ENV/compose.yaml" --env-file "$compose_env" up -d --remove-orphans --wait --wait-timeout 300
    [ -n "$host" ] || check_http "${stack}_default"
    prune_images "$TESSERY_IMAGE_PREFIX"
    ;;
  kubernetes)
    export KUBECONFIG=/work/.tessery/kubeconfig
    registry=$(jq -r '.target.registry // empty' "$plan")
    ns=$(jq -r .namespace "$plan")
    prefix="${registry:+$registry/}$project/"
    if [ -n "$registry" ]; then build "$prefix" push; else build "$prefix"; fi
    step "Applying manifests to $ns"
    kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f -
    kubectl -n "$ns" create secret generic tessery-secrets --from-env-file="$secrets" --dry-run=client -o yaml | kubectl apply -f -
    sed -e "s#__TESSERY_IMAGE_PREFIX__#$prefix#g" -e "s#__TESSERY_TAG__#$TESSERY_TAG#g" "deploy/$TESSERY_ENV/k8s.yaml" | kubectl apply -f -
    jq -r '.rollout[] | "\(.kind) \(.name)"' "$plan" | while read -r k name; do
      step "Waiting for $name"
      kubectl -n "$ns" rollout status "$k/$name" --timeout=300s
    done
    prune_images "$prefix"
    ;;
  *)
    echo "Nothing to run for a $kind target."
    ;;
esac

jq -c '.endpoints[]?' "$plan" | while read -r e; do echo "::endpoint::$e"; done
step "Done"
