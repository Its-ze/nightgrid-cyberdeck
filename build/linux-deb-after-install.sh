#!/usr/bin/env bash
set -e

dropin_dir="/etc/systemd/logind.conf.d"
dropin_file="${dropin_dir}/nightgrid-cyberdeck-lid.conf"

mkdir -p "${dropin_dir}"
cat > "${dropin_file}" <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
EOF
chmod 0644 "${dropin_file}"

if command -v systemctl >/dev/null 2>&1; then
  systemctl kill -s HUP systemd-logind.service >/dev/null 2>&1 || true
fi

echo "NightGrid Cyberdeck configured systemd-logind to ignore laptop lid close events."
echo "Policy file: ${dropin_file}"
echo "Remove the nightgrid-cyberdeck package to remove this policy."
