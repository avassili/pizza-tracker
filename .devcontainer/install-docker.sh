#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Installs or UPGRADES Docker Engine + Compose v2 on the Ubuntu/Debian HOST.
#
# This is a host prerequisite script, not a container script: the dev container
# cannot install the Docker daemon it is already running inside of. Run it from
# the repo root on the machine that will host the dev container:
#
#   bash .devcontainer/install-docker.sh --check    # report only, no changes
#   bash .devcontainer/install-docker.sh            # install / upgrade
#
# It is idempotent: re-running upgrades to the latest available package and
# never duplicates the apt source or the GPG key.
# ---------------------------------------------------------------------------
set -euo pipefail

# Ubuntu ships its own limited `docker.io` (no buildx/compose plugins, older
# version). Everything below pulls from Docker's official apt repository
# instead, which is the supported upgrade path.
DOCKER_APT_URL="https://download.docker.com/linux"
KEYRING_DIR="/etc/apt/keyrings"

CHECK_ONLY=false
ASSUME_YES=false

for arg in "$@"; do
  case "${arg}" in
    --check | -c) CHECK_ONLY=true ;;
    --yes | -y) ASSUME_YES=true ;;
    -h | --help)
      sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: ${arg} (try --help)" >&2
      exit 2
      ;;
  esac
done

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARNING:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

# --- 1. Identify the distribution ----------------------------------------
[[ -r /etc/os-release ]] || die "/etc/os-release not found; unsupported host."
# shellcheck disable=SC1091
. /etc/os-release

case "${ID:-}" in
  ubuntu | debian) DISTRO="${ID}" ;;
  *)
    die "Unsupported distribution '${ID:-unknown}'. This script supports Ubuntu and Debian only.
     On other distros install Docker Engine + Compose v2 from your package manager."
    ;;
esac

# Debian exposes VERSION_CODENAME; Ubuntu exposes UBUNTU_CODENAME as well.
CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
[[ -n "${CODENAME}" ]] || die "Could not determine apt codename from /etc/os-release."
ARCH="$(dpkg --print-architecture)"

log "Host: ${PRETTY_NAME:-${DISTRO}} (${DISTRO}/${CODENAME}, ${ARCH})"

# --- 2. Report current state ---------------------------------------------
CURRENT_VERSION="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
CURRENT_COMPOSE="$(docker compose version --short 2>/dev/null || true)"

if [[ -n "${CURRENT_VERSION}" ]]; then
  echo "    docker engine : ${CURRENT_VERSION}"
else
  echo "    docker engine : not installed (or daemon not reachable)"
fi
if [[ -n "${CURRENT_COMPOSE}" ]]; then
  echo "    compose plugin: ${CURRENT_COMPOSE}"
else
  echo "    compose plugin: not installed"
fi

# --- 3. Check-only mode --------------------------------------------------
command -v curl >/dev/null 2>&1 || die "curl is required but not installed."

if [[ "${CHECK_ONLY}" == true ]]; then
  log "Check-only mode: verifying repository reachability"
  if curl -fsSL --max-time 20 -o /dev/null \
    "${DOCKER_APT_URL}/${DISTRO}/dists/${CODENAME}/Release"; then
    echo "    Docker apt repo reachable for ${DISTRO}/${CODENAME}."
  else
    warn "Docker apt repo NOT reachable for ${DISTRO}/${CODENAME}. An install would fail."
  fi
  log "No changes made. Re-run without --check to install/upgrade."
  exit 0
fi

# --- 4. Privilege and confirmation gates ---------------------------------
SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || die "Run as root, or install sudo first."
  SUDO="sudo"
fi

if [[ "${ASSUME_YES}" == false ]]; then
  read -r -p "Install/upgrade Docker Engine + Compose v2 on this host? [y/N] " reply
  [[ "${reply}" =~ ^[Yy]$ ]] || {
    echo "Aborted."
    exit 1
  }
fi

log "Refreshing apt metadata"
${SUDO} apt-get update -y

log "Installing prerequisites"
${SUDO} apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  lsb-release

${SUDO} install -m 0755 -d "${KEYRING_DIR}"

# --- 5. GPG key ----------------------------------------------------------
log "Installing Docker apt GPG key"
# `docker.asc` is the currently documented format for the signed-by mechanism;
# the older `docker.gpg` + `apt-key add` path is deprecated.
${SUDO} curl -fsSL "${DOCKER_APT_URL}/${DISTRO}/gpg" -o "${KEYRING_DIR}/docker.asc"
${SUDO} chmod a+r "${KEYRING_DIR}/docker.asc"

log "Configuring Docker apt repository"
echo "deb [arch=${ARCH} signed-by=${KEYRING_DIR}/docker.asc] ${DOCKER_APT_URL}/${DISTRO} ${CODENAME} stable" |
  ${SUDO} tee /etc/apt/sources.list.d/docker.list >/dev/null

# --- 6. Drop packages that collide with the official ones ----------------
CONFLICTS=()
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  if dpkg -s "${pkg}" >/dev/null 2>&1; then
    CONFLICTS+=("${pkg}")
  fi
done
if [[ ${#CONFLICTS[@]} -gt 0 ]]; then
  log "Removing conflicting distro packages: ${CONFLICTS[*]}"
  # `remove`, not `purge`: /var/lib/docker is preserved so existing images and
  # volumes survive the migration.
  ${SUDO} apt-get remove -y "${CONFLICTS[@]}"
fi

# --- 7. Install or upgrade ----------------------------------------------
log "Installing or upgrading Docker Engine + Compose v2"
${SUDO} apt-get update -y
${SUDO} apt-get install -y --no-install-recommends \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

# --- 8. Enable the daemon ------------------------------------------------
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  log "Enabling and starting the docker service"
  ${SUDO} systemctl enable --now docker
else
  warn "systemd not available (WSL1 or nested container?). Start the daemon manually:
     sudo service docker start"
fi

# --- 9. Let the invoking user talk to the daemon -------------------------
TARGET_USER="${SUDO_USER:-${USER:-}}"
if [[ -n "${TARGET_USER}" && "${TARGET_USER}" != "root" ]]; then
  if id -nG "${TARGET_USER}" | grep -qw docker; then
    echo "    ${TARGET_USER} is already in the 'docker' group."
  else
    log "Adding ${TARGET_USER} to the 'docker' group"
    ${SUDO} usermod -aG docker "${TARGET_USER}"
    warn "Group membership only applies to NEW shells. Run 'newgrp docker' or log
     out and back in before using docker without sudo."
  fi
fi

# --- 10. Report ----------------------------------------------------------
log "Installed versions"
docker --version
docker compose version
docker buildx version

log "Docker is ready.
     Next: open this folder in VS Code and run
     'Dev Containers: Reopen in Container'."
