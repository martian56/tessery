FROM docker:28-cli
ARG KUBECTL=v1.33.4
RUN apk add --no-cache jq curl openssh-client \
 && tessery="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" \
 && curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL}/bin/linux/${tessery}/kubectl" \
 && chmod +x /usr/local/bin/kubectl \
 && docker compose version && docker buildx version
WORKDIR /work
