#!/bin/sh
# Runs terraform validate on every directory scripts/terraform-fixtures.ts wrote, JOBS at a time. The first
# directory runs alone so it fills TF_PLUGIN_CACHE_DIR; the rest only read from it.
set -eu
export TF_PLUGIN_CACHE_DIR=${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}

if [ "${1:-}" = --one ]; then
  dir=$2
  if ! terraform -chdir="$dir" init -backend=false -input=false -no-color >"$dir/init.log" 2>&1; then
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
mkdir -p "$TF_PLUGIN_CACHE_DIR"
dirs=$(find "$root" -name versions.tf -exec dirname {} \; | sort)
[ -n "$dirs" ] || { echo "no Terraform under $root"; exit 1; }
failed=0
sh "$0" --one "$(echo "$dirs" | head -n 1)" || failed=1
echo "$dirs" | tail -n +2 | xargs -r -P "${JOBS:-4}" -n 1 sh "$0" --one || failed=1
[ "$failed" -eq 0 ] || { echo "some directories failed"; exit 1; }
