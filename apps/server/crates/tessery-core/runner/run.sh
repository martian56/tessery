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

routed() {
  jq -e '[.endpoints[]? | select(.url | startswith("https://"))] | length > 0' "$plan" >/dev/null
}

ensure_proxy() {
  routed || return 0
  docker network inspect tessery-proxy >/dev/null 2>&1 || docker network create tessery-proxy >/dev/null
  if [ -n "$(docker ps -q --filter label=tessery.proxy)" ]; then
    return 0
  fi
  step "Starting the HTTPS proxy"
  docker rm tessery-proxy >/dev/null 2>&1 || true
  if ! docker run -d --name tessery-proxy --label tessery.proxy=true --restart unless-stopped \
    --network tessery-proxy -p 80:80 -p 443:443 -p 443:443/udp \
    -e CADDY_INGRESS_NETWORKS=tessery-proxy \
    -v /var/run/docker.sock:/var/run/docker.sock:ro -v tessery-proxy-data:/data \
    lucaslorentz/caddy-docker-proxy:2.13.1-alpine >/dev/null; then
    [ -z "$(docker ps -q --filter label=tessery.proxy)" ] || return 0
    echo "Could not start the proxy. Ports 80 and 443 on the host must be free, or used by a proxy labelled tessery.proxy=true."
    exit 1
  fi
}

check_https() {
  routed || return 0
  remote=$1
  proxy=""
  if [ -z "$remote" ]; then
    me=$(hostname)
    docker network connect tessery-proxy "$me" >/dev/null 2>&1 || true
    proxy=$(docker inspect -f '{{(index .NetworkSettings.Networks "tessery-proxy").IPAddress}}' "$(docker ps -q --filter label=tessery.proxy | head -n1)")
  fi
  jq -r '.endpoints[]? | select(.url | startswith("https://")) | "\(.name) \(.url)"' "$plan" | while read -r name url; do
    host=${url#https://}
    step "Checking $url"
    insecure=""
    case "$host" in localhost | *.localhost) insecure=-k ;; esac
    i=0
    until curl -fsS -o /dev/null --max-time 5 $insecure ${proxy:+--resolve "$host:443:$proxy"} "$url"; do
      i=$((i + 1))
      if [ "$i" -ge 30 ]; then
        echo "$url does not answer over HTTPS yet. $name is running; check that DNS for $host points at this server and that ports 80 and 443 are open."
        break
      fi
      sleep 2
    done
    [ "$i" -ge 30 ] || echo "$url is live"
  done
  [ -n "$remote" ] || docker network disconnect tessery-proxy "$(hostname)" >/dev/null 2>&1 || true
}

probe() {
  network=$1 ip=$2 port=$3 path=$4
  docker run --rm --network "$network" busybox:1.37 wget -q -O /dev/null -T 3 "http://$ip:$port$path" >/dev/null 2>&1
}

wait_ready() {
  name=$1 id=$2 network="${stack}_default"
  check=$(jq -r --arg n "$name" '.checks[]? | select(.name == $n) | "\(.port) \(.path)"' "$plan")
  i=0
  while [ "$i" -lt 60 ]; do
    state=$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || echo gone)
    [ "$state" = running ] || { [ "$state" = created ] || [ "$state" = restarting ]; } || return 1
    if [ "$state" = running ]; then
      if [ -z "$check" ]; then
        [ "$i" -ge 2 ] && return 0
      else
        ip=$(docker inspect -f "{{with index .NetworkSettings.Networks \"$network\"}}{{.IPAddress}}{{end}}" "$id")
        set -- $check
        [ -n "$ip" ] && probe "$network" "$ip" "$1" "$2" && return 0
      fi
    fi
    i=$((i + 1))
    sleep 2
  done
  return 1
}

rolling_up() {
  compose="docker compose -p $stack -f deploy/$TESSERY_ENV/compose.yaml --env-file $compose_env"
  data=$(jq -r '.rollout[] | select(.kind == "statefulset") | .name' "$plan")
  apps=$(jq -r '.rollout[] | select(.kind == "deployment") | .name' "$plan")
  if [ -n "$data" ]; then
    step "Starting data stores"
    $compose up -d --no-deps --wait --wait-timeout 300 $data
  fi
  for name in $apps; do
    old=$(docker ps -q --filter "label=com.docker.compose.project=$stack" --filter "label=com.docker.compose.service=$name")
    if [ -z "$old" ]; then
      step "Starting $name"
      $compose up -d --no-deps "$name"
      for id in $(docker ps -q --filter "label=com.docker.compose.project=$stack" --filter "label=com.docker.compose.service=$name"); do
        wait_ready "$name" "$id" || { echo "$name did not become ready"; $compose logs --tail 40 "$name" || true; exit 1; }
      done
      continue
    fi
    count=$(echo "$old" | wc -l | tr -d ' ')
    step "Starting the new $name next to the running one"
    $compose up -d --no-deps --no-recreate --scale "$name=$((count * 2))" "$name"
    new=$(docker ps -q --filter "label=com.docker.compose.project=$stack" --filter "label=com.docker.compose.service=$name" | grep -v -F "$old" || true)
    for id in $new; do
      if ! wait_ready "$name" "$id"; then
        echo "The new $name did not become ready, so the running one keeps serving. Its last log lines:"
        docker logs --tail 40 "$id" 2>&1 || true
        docker rm -f $new >/dev/null 2>&1 || true
        exit 1
      fi
    done
    step "Stopping the old $name"
    docker stop -t 15 $old >/dev/null
    docker rm $old >/dev/null
    echo "$name switched to the new version with no downtime"
  done
  $compose up -d --no-recreate --remove-orphans >/dev/null
}

use_docker_host() {
  host=${TESSERY_DOCKER_HOST:-$(jq -r '.target.host // empty' "$plan")}
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

# Runs deploy/<env>/contract.json: HTTP checks made from the API and database design. Each check names the request and
# what it expects; the first one that fails stops the release with its name. On a remote server the requests run in a
# short-lived curl container on the stack's network, since the runner cannot join a network on another machine.
check_contract() {
  network=$1 remote=$2
  file="deploy/$TESSERY_ENV/contract.json"
  [ -f "$file" ] || return 0
  total=$(jq '.checks | length' "$file")
  step "Checking the API against its design ($total checks, $(jq -r .mode "$file"))"
  vars=/tmp/contract-vars.json body=/tmp/contract-body
  echo '{}' > "$vars"
  if [ -z "$remote" ]; then
    docker network connect "$network" "$(hostname)" >/dev/null 2>&1 || true
  fi
  i=0
  while [ "$i" -lt "$total" ]; do
    check=$(jq -c --slurpfile v "$vars" --argjson i "$i" '.checks[$i] | .path |= (reduce ($v[0] | to_entries[]) as $e (.; gsub("\\{\\{" + $e.key + "\\}\\}"; $e.value)))' "$file")
    name=$(printf '%s' "$check" | jq -r .name)
    method=$(printf '%s' "$check" | jq -r .method)
    url=$(printf '%s' "$check" | jq -r '"http://\(.service):\(.port)\(.path)"')
    data=$(printf '%s' "$check" | jq -c '.body // empty')
    if [ -z "$remote" ]; then
      if [ -n "$data" ]; then
        code=$(curl -s -o "$body" -w '%{http_code}' --max-time 15 -X "$method" -H 'content-type: application/json' --data "$data" "$url" || echo 000)
      else
        code=$(curl -s -o "$body" -w '%{http_code}' --max-time 15 -X "$method" "$url" || echo 000)
      fi
    else
      if [ -n "$data" ]; then
        out=$(docker run --rm --network "$network" curlimages/curl:8.11.1 -s -w '\n%{http_code}' --max-time 15 -X "$method" -H 'content-type: application/json' --data "$data" "$url" || printf '\n000')
      else
        out=$(docker run --rm --network "$network" curlimages/curl:8.11.1 -s -w '\n%{http_code}' --max-time 15 -X "$method" "$url" || printf '\n000')
      fi
      code=$(printf '%s\n' "$out" | tail -n 1)
      printf '%s\n' "$out" | sed '$d' > "$body"
    fi
    if ! printf '%s' "$check" | jq -e --argjson c "${code:-0}" 'any(.status[]; . == $c)' >/dev/null; then
      echo "::error::API check failed: $name. It answered $code, the design expects $(printf '%s' "$check" | jq -r '.status | map(tostring) | join(" or ")')."
      head -c 600 "$body" 2>/dev/null; echo
      exit 1
    fi
    shape=$(printf '%s' "$check" | jq -r '.shape // empty')
    if [ -n "$shape" ] && ! jq -e "$shape" "$body" >/dev/null 2>&1; then
      fields=$(printf '%s' "$check" | jq -c '.fields // []')
      missing=$(jq -r --argjson f "$fields" '(if type == "array" then ([.[] | select(type == "object")][0] // {}) else . end) as $o | if ($o | type) == "object" then [$f[] | select(. as $k | $o | has($k) | not)] | join(", ") else "" end' "$body" 2>/dev/null || true)
      echo "::error::API check failed: $name. The response does not have the fields the design gives it${missing:+ (missing: $missing)}."
      head -c 600 "$body" 2>/dev/null; echo
      exit 1
    fi
    printf '%s' "$check" | jq -r '.save // {} | to_entries[] | "\(.key) \(.value)"' | while read -r key expr; do
      value=$(jq -r "$expr" "$body")
      jq --arg k "$key" --arg v "$value" '.[$k] = $v' "$vars" > "$vars.next" && mv "$vars.next" "$vars"
    done
    echo "passed: $name"
    i=$((i + 1))
  done
  if [ -z "$remote" ]; then
    docker network disconnect "$network" "$(hostname)" >/dev/null 2>&1 || true
  fi
}

case "$kind" in
  docker)
    use_docker_host
    export TESSERY_IMAGE_PREFIX="tessery/$project/" TESSERY_TAG
    build "$TESSERY_IMAGE_PREFIX"
    ensure_proxy
    if [ "$(jq -r '.strategy // "recreate"' "$plan")" != recreate ] && routed && [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$stack")" ]; then
      rolling_up
    else
      step "Starting $stack"
      docker compose -p "$stack" -f "deploy/$TESSERY_ENV/compose.yaml" --env-file "$compose_env" up -d --remove-orphans --wait --wait-timeout 300
    fi
    [ -n "$host" ] || check_http "${stack}_default"
    check_contract "${stack}_default" "$host"
    check_https "$host"
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
