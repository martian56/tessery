#!/bin/sh
set -eu
mirror=${TF_PROVIDER_MIRROR:-$HOME/.terraform.d/mirror}

if [ "${1:-}" = --one ]; then
  dir=$2
  if ! terraform -chdir="$dir" init -backend=false -input=false -no-color -plugin-dir="$mirror" >"$dir/init.log" 2>&1; then
    echo "FAIL init $dir"; cat "$dir/init.log"; exit 1
  fi
  if terraform -chdir="$dir" validate -no-color >"$dir/validate.log" 2>&1; then
    echo "ok   $dir"
  else
    echo "FAIL $dir"; cat "$dir/validate.log"; exit 1
  fi
  exit 0
fi

root=${1:-dist/terraform}
dirs=$(find "$root" -name versions.tf -not -path '*/.providers/*' -exec dirname {} \; | sort)
[ -n "$dirs" ] || { echo "no Terraform under $root"; exit 1; }

# Parallel inits can't share a plugin cache, so every provider is mirrored once and each init only reads it.
all="$root/.providers"
mkdir -p "$all" "$mirror"
{
  echo 'terraform {'
  echo '  required_providers {'
  for dir in $dirs; do grep 'source = ' "$dir/versions.tf"; done | sort -u
  echo '  }'
  echo '}'
} >"$all/versions.tf"
terraform -chdir="$all" providers mirror -platform=linux_amd64 "$mirror" >/dev/null

echo "$dirs" | xargs -P "${JOBS:-4}" -n 1 sh "$0" --one
