#!/usr/bin/env bash
set -euo pipefail

repo="${NIGHTGRID_REPO:-Its-ze/nightgrid-cyberdeck}"
asset="NightGrid-Cyberdeck-Linux-x64.AppImage"
url="https://github.com/${repo}/releases/latest/download/${asset}"
primary_install_dir="${NIGHTGRID_INSTALL_DIR:-${XDG_BIN_HOME:-${HOME}/Applications}}"
fallback_install_dir="${XDG_DATA_HOME:-${HOME}/.local/share}/nightgrid-cyberdeck"
existing=0

can_write_dir() {
  local dir="$1"
  local probe
  mkdir -p "${dir}" 2>/dev/null || return 1
  probe="${dir}/.nightgrid-write-test.$$"
  : > "${probe}" 2>/dev/null || return 1
  rm -f -- "${probe}"
}

choose_target() {
  if can_write_dir "${primary_install_dir}"; then
    printf '%s\n' "${primary_install_dir}/NightGrid-Cyberdeck.AppImage"
    return 0
  fi

  if can_write_dir "${fallback_install_dir}"; then
    printf '%s\n' "${fallback_install_dir}/NightGrid-Cyberdeck.AppImage"
    return 0
  fi

  echo "No writable NightGrid install directory found." >&2
  echo "Tried ${primary_install_dir} and ${fallback_install_dir}" >&2
  return 1
}

target="$(choose_target)"
if [[ -f "${target}" ]]; then
  existing=1
fi

tmp="$(mktemp "${TMPDIR:-/tmp}/NightGrid-Cyberdeck.AppImage.XXXXXX")"
cleanup() {
  rm -f "${tmp}"
}
trap cleanup EXIT

echo "Downloading ${url}"
curl --fail --location --show-error "${url}" -o "${tmp}"
chmod +x "${tmp}"
mv -f "${tmp}" "${target}"
trap - EXIT

desktop_dir="${XDG_DATA_HOME:-${HOME}/.local/share}/applications"
mkdir -p "${desktop_dir}"
cat > "${desktop_dir}/nightgrid-cyberdeck.desktop" <<EOF
[Desktop Entry]
Name=NightGrid Cyberdeck
Comment=USB field console for Heltec, T-Deck, Flipper, GPS, Pico, and serial devices
Exec=${target}
Terminal=false
Type=Application
Categories=Utility;Development;
EOF

update-desktop-database "${desktop_dir}" >/dev/null 2>&1 || true
if [[ "${existing}" == "1" ]]; then
  echo "Updated NightGrid Cyberdeck at ${target}"
else
  echo "Installed NightGrid Cyberdeck at ${target}"
fi
echo "Run this installer again any time to update the existing AppImage."
echo "If USB serial ports fail to open, add your user to the dialout group and log in again:"
echo "  sudo usermod -aG dialout \"\$USER\""
