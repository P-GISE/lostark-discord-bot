#!/usr/bin/env bash
set -euo pipefail
umask 077
scan_temp=$(mktemp -d)
trap 'rm -rf -- "$scan_temp"' EXIT
mkdir -p "$scan_temp/bin" "$scan_temp/inputs/tree" "$scan_temp/ignore"
fetch_tool() {
  local tool_url=$1 tool_sha=$2 tool_name=$3
  curl --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 "$tool_url" -o "$scan_temp/tool.tar.gz"
  printf '%s  %s\n' "$tool_sha" "$scan_temp/tool.tar.gz" | sha256sum --check --status
  tar -xzf "$scan_temp/tool.tar.gz" -C "$scan_temp/bin" "$tool_name"
}
fetch_tool 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz' '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb' gitleaks
fetch_tool 'https://github.com/aquasecurity/trivy/releases/download/v0.76.1/trivy_0.76.1_Linux-64bit.tar.gz' 'c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0' trivy
# Only tracked HEAD content; no runner credentials, Git metadata, or untracked environment files.
git archive --format=tar HEAD | tar -xf - -C "$scan_temp/inputs/tree"
python3 scripts/security/prepare-inputs.py "$scan_temp"
printf '[extend]\nuseDefault = true\n' > "$scan_temp/gitleaks.toml"
export GITLEAKS_CONFIG="$scan_temp/gitleaks.toml"
unset GITLEAKS_CONFIG_TOML || true
leak_args=(--config "$scan_temp/gitleaks.toml" --gitleaks-ignore-path "$scan_temp/ignore" --ignore-gitleaks-allow --redact=100 --no-banner --no-color --log-level error --report-format json)
tree_status=0
"$scan_temp/bin/gitleaks" dir "$scan_temp/inputs/tree" "${leak_args[@]}" --report-path "$scan_temp/tree.json" > "$scan_temp/tree.log" 2>&1 || tree_status=$?
history_status=0
base=${SCAN_BASE:-}
if [[ "$base" =~ ^[0-9a-f]{40}$ && "$base" != 0000000000000000000000000000000000000000 ]]; then
  git cat-file -e "$base^{commit}"
  log_opts="$base..HEAD"
else
  # Initial branch/manual runs: latest commit plus complete current tracked tree, not historical attestation.
  log_opts='-1 HEAD'
fi
"$scan_temp/bin/gitleaks" git . "${leak_args[@]}" --log-opts="$log_opts" --report-path "$scan_temp/history.json" > "$scan_temp/history.log" 2>&1 || history_status=$?
vuln_status=0
"$scan_temp/bin/trivy" fs --config='' --ignorefile='' --secret-config='' --scanners vuln --include-dev-deps --severity HIGH,CRITICAL --exit-code 1 --offline-scan --disable-telemetry --skip-version-check --no-progress --format json --output "$scan_temp/vuln.json" "$scan_temp/inputs" > "$scan_temp/vuln.log" 2>&1 || vuln_status=$?
# Do not upload raw reports/logs: git output can contain author metadata or secret context.
python3 scripts/security/summarize.py "$scan_temp" "$tree_status" "$history_status" "$vuln_status"
