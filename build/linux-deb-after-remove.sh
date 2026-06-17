#!/usr/bin/env bash
set -e

dropin_file="/etc/systemd/logind.conf.d/nightgrid-cyberdeck-lid.conf"

if [ -f "${dropin_file}" ]; then
  rm -f "${dropin_file}"
  echo "Removed NightGrid Cyberdeck lid-close policy."
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl kill -s HUP systemd-logind.service >/dev/null 2>&1 || true
fi
