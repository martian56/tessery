#!/bin/sh
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
seen=' '
first=''
rest=''
for dir in $dirs; do
  set_id=$(grep 'source = ' "$dir/versions.tf" | sort | cksum | cut -d' ' -f1)
  case "$seen" in
    *" $set_id "*) rest="$rest $dir" ;;
    *) seen="$seen$set_id "; first="$first $dir" ;;
  esac
done
for dir in $first; do sh "$0" --one "$dir" || failed=1; done
echo $rest | tr ' ' '\n' | sed '/^$/d' | xargs -r -P "${JOBS:-4}" -n 1 sh "$0" --one || failed=1
[ "$failed" -eq 0 ] || { echo "some directories failed"; exit 1; }
