#!/usr/bin/env bash
set -euo pipefail

repo="${NIGHTGRID_REPO:-Its-ze/nightgrid-cyberdeck}"
asset="NightGrid-Cyberdeck-Linux-x64.AppImage"
url="https://github.com/${repo}/releases/latest/download/${asset}"
primary_install_dir="${NIGHTGRID_INSTALL_DIR:-${XDG_BIN_HOME:-${HOME}/Applications}}"
fallback_install_dir="${XDG_DATA_HOME:-${HOME}/.local/share}/nightgrid-cyberdeck"
meshtastic_venv="${fallback_install_dir}/meshtastic-venv"
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

setup_meshtastic_cli() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 was not found. Skipping Meshtastic CLI setup."
    echo "Install python3 and python3-venv, then rerun this installer to enable Mesh CLI commands."
    return 0
  fi

  echo "Setting up Meshtastic CLI in ${meshtastic_venv}"
  mkdir -p "$(dirname "${meshtastic_venv}")"
  if ! python3 -m venv "${meshtastic_venv}" >/dev/null 2>&1; then
    echo "Could not create Python venv for Meshtastic CLI."
    echo "Install your distro's venv package, then rerun this installer:"
    echo "  Debian/Ubuntu/Pop!_OS: sudo apt install python3-venv"
    echo "  Fedora: sudo dnf install python3"
    echo "  openSUSE: sudo zypper install python3 python3-pip"
    return 0
  fi

  if ! "${meshtastic_venv}/bin/python" -m pip install --upgrade pip meshtastic; then
    echo "Could not install Meshtastic CLI into ${meshtastic_venv}."
    echo "NightGrid was still installed. Rerun this installer after Python/pip networking is fixed."
    return 0
  fi
  echo "Meshtastic CLI ready at ${meshtastic_venv}/bin/python -m meshtastic"
}

if [[ "${NIGHTGRID_SKIP_MESHTASTIC_SETUP:-0}" != "1" ]]; then
  setup_meshtastic_cli
else
  echo "Skipped Meshtastic CLI setup because NIGHTGRID_SKIP_MESHTASTIC_SETUP=1"
fi

if [[ "${existing}" == "1" ]]; then
  echo "Updated NightGrid Cyberdeck at ${target}"
else
  echo "Installed NightGrid Cyberdeck at ${target}"
fi
echo "Run this installer again any time to update the existing AppImage."
echo "If USB serial ports fail to open, add your user to the dialout group and log in again:"
echo "  sudo usermod -aG dialout \"\$USER\""
echo "NightGrid Mesh CLI uses the managed Meshtastic venv at:"
echo "  ${meshtastic_venv}/bin/python -m meshtastic"
