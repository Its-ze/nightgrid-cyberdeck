#!/usr/bin/env bash
set -euo pipefail

install_dir="${NIGHTGRID_INSTALL_DIR:-${XDG_BIN_HOME:-${HOME}/Applications}}"
target="${install_dir}/NightGrid-Cyberdeck.AppImage"
desktop_file="${XDG_DATA_HOME:-${HOME}/.local/share}/applications/nightgrid-cyberdeck.desktop"
removed=0

if [[ -f "${target}" ]]; then
  rm -f -- "${target}"
  echo "Removed ${target}"
  removed=1
fi

if [[ -f "${desktop_file}" ]]; then
  rm -f -- "${desktop_file}"
  echo "Removed ${desktop_file}"
  removed=1
fi

if command -v dpkg-query >/dev/null 2>&1 && dpkg-query -W -f='${Status}' nightgrid-cyberdeck 2>/dev/null | grep -q "install ok installed"; then
  echo "Removing installed nightgrid-cyberdeck package"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get remove -y nightgrid-cyberdeck
  else
    sudo dpkg -r nightgrid-cyberdeck
  fi
  removed=1
fi

if [[ "${NIGHTGRID_PURGE_DATA:-0}" == "1" ]]; then
  config_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/NightGrid Cyberdeck"
  if [[ -d "${config_dir}" && "${config_dir}" == "${HOME}"/* ]]; then
    rm -rf -- "${config_dir}"
    echo "Removed ${config_dir}"
    removed=1
  fi
fi

update-desktop-database "$(dirname "${desktop_file}")" >/dev/null 2>&1 || true

if [[ "${removed}" == "0" ]]; then
  echo "NightGrid Cyberdeck was not found in the standard install locations."
else
  echo "NightGrid Cyberdeck uninstall complete."
fi

echo "Set NIGHTGRID_PURGE_DATA=1 before running this script to also remove app settings."
