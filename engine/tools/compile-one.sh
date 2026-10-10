#!/bin/sh
# Compile one engine source to build/obj/<path_with_underscores>.o (skips if up to date).
# Flags come from build-wasm.sh via INC_S / DEFS_S / WARN_S / OPT_S.
src="$1"
obj="build/obj/$(echo "$src" | tr "/" "_").o"
if [ -f "$obj" ] && [ ! "$src" -nt "$obj" ]; then exit 0; fi
case "$src" in *.cpp) std=-std=gnu++11 ;; *) std=-std=gnu11 ;; esac
# shellcheck disable=SC2086
exec emcc $std $OPT_S $WARN_S $DEFS_S $INC_S -c "$src" -o "$obj"
