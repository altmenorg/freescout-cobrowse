#!/usr/bin/env bash
#
# Install (or remove) the co-browsing relay as a systemd service.
#
#   sudo bash install.sh --site https://www.example.com --helpdesk https://helpdesk.example.com
#   sudo bash install.sh uninstall         # stop and remove the service, keep the secret
#   sudo bash install.sh uninstall --purge # remove the secret file too
#
# Install options (asked for when missing and run from a terminal):
#   --site URL[,URL...]   your website(s): only their pages can start a session (COBROWSE_CLIENT_ORIGINS)
#   --helpdesk URL        your FreeScout: only it can join a session (COBROWSE_AGENT_ORIGINS)
#   --port PORT           port on 127.0.0.1 (default 8095)
#   --user USER           user the relay runs as (default www-data)
#   --secret-file PATH    file holding the shared secret (default /etc/cobrowse-secret)
#   --dir PATH            where the relay is installed (default /opt/cobrowse-relay)
#
# The relay is copied out of the module folder, which FreeScout replaces on each module update. Run this
# script again after an update to install the new relay: it keeps the existing secret, so FreeScout's
# settings stay valid.

set -euo pipefail

SERVICE=cobrowse-relay
UNIT="${COBROWSE_UNIT_FILE:-/etc/systemd/system/$SERVICE.service}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAY_DIR=/opt/cobrowse-relay

ACTION=install
SITES=""
HELPDESK=""
PORT=8095
RUN_USER=www-data
SECRET_FILE=/etc/cobrowse-secret
PURGE=0

die() { echo "Error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

usage() {
    sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

# An origin is scheme://host[:port], with no path: what the browser sends in the Origin header.
normalize_origins() {
    local out="" item
    IFS=',' read -ra items <<< "$1"
    for item in "${items[@]}"; do
        item="$(echo "$item" | tr -d '[:space:]')"
        [ -n "$item" ] || continue
        item="${item%/}"
        [[ "$item" =~ ^https?://[^/]+$ ]] || die "'$item' is not an origin like https://www.example.com (no path)"
        out="${out:+$out,}$item"
    done
    echo "$out"
}

while [ $# -gt 0 ]; do
    case "$1" in
        install) ACTION=install ;;
        uninstall) ACTION=uninstall ;;
        --site|--sites) SITES="${2:-}"; shift ;;
        --helpdesk) HELPDESK="${2:-}"; shift ;;
        --port) PORT="${2:-}"; shift ;;
        --user) RUN_USER="${2:-}"; shift ;;
        --secret-file) SECRET_FILE="${2:-}"; shift ;;
        --dir) RELAY_DIR="${2:-}"; shift ;;
        --purge) PURGE=1 ;;
        -h|--help) usage 0 ;;
        *) echo "Unknown option: $1" >&2; usage 1 ;;
    esac
    shift
done

[ "$(id -u)" -eq 0 ] || die "run it as root (sudo $0 ...)"
command -v systemctl >/dev/null || die "systemd is required (see the README for supervisord)"

uninstall() {
    if [ -f "$UNIT" ]; then
        info "Stopping and removing the $SERVICE service"
        systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
        rm -f "$UNIT"
        systemctl daemon-reload
    else
        info "No $SERVICE service installed"
    fi
    if [ -f "$RELAY_DIR/relay.js" ]; then
        rm -rf "$RELAY_DIR" && info "Removed $RELAY_DIR"
    fi
    if [ "$PURGE" -eq 1 ]; then
        rm -f "$SECRET_FILE" && info "Removed $SECRET_FILE"
    elif [ -f "$SECRET_FILE" ]; then
        info "Kept $SECRET_FILE (add --purge to remove it)"
    fi
    echo
    echo "Done. Remember to remove the /cobrowse/ws block from your web server, and to set the provider back in"
    echo "FreeScout (Manage > Settings > Cobrowse) if you no longer use the self-hosted relay."
}

if [ "$ACTION" = uninstall ]; then
    uninstall
    exit 0
fi

# --- install -----------------------------------------------------------------------------------------------

NODE="$(command -v node || true)"
[ -n "$NODE" ] || die "Node.js 18 or later is required (https://nodejs.org, or your distribution's package)"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 18 or later is required, found $("$NODE" -v)"
id "$RUN_USER" >/dev/null 2>&1 || die "user '$RUN_USER' does not exist (use --user)"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port must be a number"
[ -f "$SOURCE_DIR/relay.js" ] || die "relay.js not found next to this script"
case "$RELAY_DIR" in /|/usr|/usr/*|/etc|/var|/home|"") die "--dir $RELAY_DIR is not a folder of its own" ;; esac

if [ -z "$SITES" ] && [ -t 0 ]; then
    read -rp "Your website(s), comma-separated (e.g. https://www.example.com): " SITES
fi
if [ -z "$HELPDESK" ] && [ -t 0 ]; then
    read -rp "Your FreeScout (e.g. https://helpdesk.example.com): " HELPDESK
fi
[ -n "$SITES" ] || die "--site is required"
[ -n "$HELPDESK" ] || die "--helpdesk is required"
SITES="$(normalize_origins "$SITES")"
HELPDESK="$(normalize_origins "$HELPDESK")"

command -v npm >/dev/null || die "npm is required to install the relay's dependency"
if [ "$SOURCE_DIR" != "$RELAY_DIR" ]; then
    info "Copying the relay to $RELAY_DIR"
    install -d -m 755 "$RELAY_DIR"
    install -m 644 "$SOURCE_DIR/relay.js" "$SOURCE_DIR/package.json" "$SOURCE_DIR/package-lock.json" "$RELAY_DIR/"
    install -m 755 "$SOURCE_DIR/install.sh" "$RELAY_DIR/"
fi
info "Installing the relay's dependency (ws)"
(cd "$RELAY_DIR" && npm ci --omit=dev --no-audit --no-fund --silent)

if [ -s "$SECRET_FILE" ]; then
    info "Keeping the existing secret in $SECRET_FILE"
else
    info "Creating the shared secret in $SECRET_FILE"
    (umask 077 && "$NODE" -e 'process.stdout.write(require("crypto").randomBytes(36).toString("base64url"))' > "$SECRET_FILE")
fi
chown "$RUN_USER" "$SECRET_FILE"
chmod 600 "$SECRET_FILE"
SECRET="$(cat "$SECRET_FILE")"
[ "${#SECRET}" -ge 32 ] || die "the secret in $SECRET_FILE is shorter than 32 characters"

info "Writing $UNIT"
cat > "$UNIT" <<EOF
[Unit]
Description=FreeScout co-browsing relay
After=network.target

[Service]
User=$RUN_USER
WorkingDirectory=$RELAY_DIR
ExecStart=$NODE relay.js
Environment=COBROWSE_PORT=$PORT
Environment=COBROWSE_SECRET_FILE=$SECRET_FILE
Environment=COBROWSE_CLIENT_ORIGINS=$SITES
Environment=COBROWSE_AGENT_ORIGINS=$HELPDESK
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

info "Checking the relay"
HEALTH=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
    HEALTH="$("$NODE" -e '
        require("http").get("http://127.0.0.1:" + process.argv[1] + "/cobrowse/health", r => {
            let b = ""; r.on("data", d => b += d); r.on("end", () => process.stdout.write(b));
        }).on("error", () => {});' "$PORT" 2>/dev/null || true)"
    [ -n "$HEALTH" ] && break
    sleep 1
done
if [ -z "$HEALTH" ]; then
    echo
    journalctl -u "$SERVICE" -n 20 --no-pager || true
    die "the relay does not answer on 127.0.0.1:$PORT (see the log above)"
fi
info "The relay answers: $HEALTH"

PUBLIC_HOST="$(echo "${SITES%%,*}" | sed -E 's#^https?://##')"

cat <<EOF

The relay runs as the '$SERVICE' service, on 127.0.0.1:$PORT.

1. Publish it over HTTPS at /cobrowse/ws on your website's domain ($PUBLIC_HOST).

   nginx, in the server { ... } of $PUBLIC_HOST, then reload nginx:

    location /cobrowse/ws {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

   Apache (mod_proxy_wstunnel):

    ProxyPass "/cobrowse/ws" "ws://127.0.0.1:$PORT/cobrowse/ws"

2. In FreeScout, Manage > Settings > Cobrowse:
     Provider      Self-hosted relay
     Relay URL     wss://$PUBLIC_HOST/cobrowse/ws
     Relay secret  $SECRET

3. Add the script to your website: see "On your website" in the README.

Logs: journalctl -u $SERVICE -f        Remove: sudo bash $RELAY_DIR/install.sh uninstall
EOF
