#!/bin/bash
# Roda DENTRO do Ubuntu, no build: ubuntu/build.sh dá boot no disco com a CLI
# do unkernel (com rede) e executa este script; o build apaga a pasta depois.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
dir=/var/tmp/mini-linux
pkgs=$(sed 's/#.*//' "$dir/packages.txt" | xargs)

# O Ubuntu Base vem "minimizado": o dpkg descarta as man pages e /usr/bin/man
# é um script que só avisa disso. Desfazemos as duas coisas (como o
# `unminimize`, mas só para o que este script instala).
sed -i '\|/usr/share/man|d' /etc/dpkg/dpkg.cfg.d/excludes
if [ "$(dpkg-divert --truename /usr/bin/man)" = /usr/bin/man.REAL ]; then
	rm -f /usr/bin/man
	dpkg-divert --quiet --remove --rename /usr/bin/man
fi

# Só o repositório main: os índices têm ~2 MB em vez de ~30 MB com o universe.
cat > "$dir/sources.list" <<SOURCES
deb http://ports.ubuntu.com/ubuntu-ports noble main
deb http://ports.ubuntu.com/ubuntu-ports noble-updates main
deb http://ports.ubuntu.com/ubuntu-ports noble-security main
SOURCES
apt() { apt-get -o Dir::Etc::SourceList="$dir/sources.list" -o Dir::Etc::SourceParts=/nonexistent "$@"; }

apt update
apt install -y --no-install-recommends $pkgs
# As man pages dos comandos que já vinham no sistema (ls, grep, find...).
apt install -y --reinstall --no-install-recommends coreutils findutils grep sed tar gzip bash procps util-linux diffutils

# Sem índices nem .deb no disco: a imagem fica menor e o browser baixa menos.
apt-get clean
rm -rf /var/lib/apt/lists/*
echo "mini-linux: pacotes instalados: $pkgs"
