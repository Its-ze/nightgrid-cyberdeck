#!/usr/bin/env bash
set -euo pipefail

repo="${NIGHTGRID_REPO:-Its-ze/nightgrid-cyberdeck}"
asset="NightGrid-Cyberdeck-Linux-x64.AppImage"
url="https://github.com/${repo}/releases/latest/download/${asset}"
install_dir="${NIGHTGRID_INSTALL_DIR:-${XDG_BIN_HOME:-${HOME}/Applications}}"
target="${install_dir}/NightGrid-Cyberdeck.AppImage"
existing=0

if [[ -f "${target}" ]]; then
  existing=1
fi

mkdir -p "${install_dir}"
tmp="$(mktemp "${install_dir}/.NightGrid-Cyberdeck.AppImage.XXXXXX")"
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
