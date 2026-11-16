#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Adaptado de kernel/guest/ubuntu-disk.sh do unkernel
# (Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>, https://github.com/pithings/unkernel).
#
# Gera vendor/ubuntu.ext4: Ubuntu Base 24.04 LTS riscv64 (glibc, bash, dpkg,
# apt; sem init system) como disco ext4 para o kernel do unkernel dar boot
# direto (cmdline "console=hvc0 root=/dev/wda rw"). Não precisa de root:
# `mke2fs -d` a partir da árvore extraída e debugfs restaura donos e bits
# setuid (ubuntu/ext4-owners.py). Precisa de curl, e2fsprogs, python3 e
# Bun (roda a CLI do unkernel, que instala os pacotes).
#
# O que difere do original:
#   - ubuntu/rootfs/ é copiado por cima do sistema (os arquivos do minicurso);
#   - hostname "ubuntu", mensagem de boas-vindas em português;
#   - pacotes de ubuntu/packages.txt instalados com o apt do próprio Ubuntu,
#     dando boot no disco com a CLI do unkernel (com rede, só no build);
#   - sem o drop-in do systemd.
#
#   bun run build:disk     (DISK_SIZE=1G por padrão)

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/vendor"
dl="$root/vendor/downloads"
size="${DISK_SIZE:-1G}"
mkdir -p "$out" "$dl"

UBUNTU_VERSION=24.04.5
UBUNTU_TARBALL_NAME="ubuntu-base-$UBUNTU_VERSION-base-riscv64.tar.gz"
UBUNTU_URL="https://cdimage.ubuntu.com/ubuntu-base/releases/${UBUNTU_VERSION%.*}/release/$UBUNTU_TARBALL_NAME"
UBUNTU_SHA256=651c516f291259ec913caa1efd0cfff738cd223adfc6617c884f07af487f08cf

# Baixa URL para FILE, a menos que FILE já exista com esse SHA-256.
fetch_verified() {
	local url="$1" file="$2" sum="$3"
	if [ -f "$file" ] && echo "$sum  $file" | sha256sum -c --status; then return 0; fi
	curl -fL --retry 3 -o "$file.part" "$url"
	echo "$sum  $file.part" | sha256sum -c --status || { echo "sha256 inválido: $url" >&2; rm -f "$file.part"; exit 1; }
	mv "$file.part" "$file"
}

export PATH="$PATH:/usr/sbin:/sbin"
for t in mke2fs debugfs e2fsck; do
	command -v "$t" >/dev/null || { echo "need $t (e2fsprogs >= 1.43 for mke2fs -d)" >&2; exit 1; }
done

if [ -z "${UBUNTU_TARBALL:-}" ]; then
	UBUNTU_TARBALL="$dl/$UBUNTU_TARBALL_NAME"
	fetch_verified "$UBUNTU_URL" "$UBUNTU_TARBALL" "$UBUNTU_SHA256"
fi
echo "ubuntu: $UBUNTU_TARBALL"

stage="$out/build/root"
rm -rf "$stage"
mkdir -p "$stage"
# No device nodes in Ubuntu Base, so an unprivileged extraction is complete
# apart from owners and setuid bits, which ext4-owners.py restores.
tar -xzf "$UBUNTU_TARBALL" -C "$stage" --no-same-owner --no-same-permissions
chmod -R u+rwX "$stage"
# --no-same-permissions applies the umask, which drops the sticky,
# world-writable mode of /tmp and /var/tmp.
chmod 1777 "$stage/tmp" "$stage/var/tmp"

# --- boot configuration -----------------------------------------------------
echo ubuntu > "$stage/etc/hostname"
printf '127.0.0.1\tlocalhost\n127.0.1.1\tubuntu\n::1\tlocalhost ip6-localhost ip6-loopback\n' > "$stage/etc/hosts"
# DNS da rede user-mode da CLI do unkernel (usada só no build, para o apt).
echo "nameserver 10.0.2.3" > "$stage/etc/resolv.conf"

cat > "$stage/etc/fstab" <<'EOF'
/dev/wda	/		ext4	rw,relatime		0 1
proc		/proc		proc	nosuid,nodev,noexec	0 0
sysfs		/sys		sysfs	nosuid,nodev,noexec	0 0
devpts		/dev/pts	devpts	gid=5,mode=620		0 0
tmpfs		/dev/shm	tmpfs	nosuid,nodev,mode=1777	0 0
tmpfs		/run		tmpfs	nosuid,nodev,mode=755	0 0
EOF

mkdir -p "$stage/usr/local/sbin"
# PID 1 without an init system. Bash, because Ubuntu Base has no busybox
# and its dash cannot wait for a child and a signal at once.
cat > "$stage/usr/local/sbin/kw-init" <<'EOF'
#!/bin/bash
# unkernel: PID 1 for Ubuntu Base without an init system. Mounts the API
# file systems, runs a root login shell on the console, and powers off when
# it exits; poweroff/reboot (/usr/local/sbin) signal this process.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/root LANG=C.UTF-8
shutdown_now() {
	trap '' USR1 USR2 TERM
	# From here on, not bash's "Killed" notices for its children (it may
	# print them at any later command).
	exec 3>&2 2>/dev/null
	kill -TERM -1
	sleep 0.2
	kill -KILL -1
	wait
	sync
	# Remounting read-only flushes the journal and marks the fs clean.
	mount -o remount,ro / 2>&3 && echo "kw-shutdown: / is clean (read-only)"
	sync
	# reboot(2) is syscall 142 on riscv64: no reboot binary without systemd.
	exec perl -e 'syscall(142, 0xfee1dead, 0x28121969, hex($ARGV[0])); die "reboot: $!\n"' "$1" 2>&3
}
if [ $$ != 1 ]; then
	echo "kw-init: not PID 1" >&2
	exit 1
fi
mountpoint -q /dev || mount -t devtmpfs devtmpfs /dev
mkdir -p /dev/pts /dev/shm
mount -a
mkdir -p /run/lock
: > /run/kw-init
hostname -F /etc/hostname 2>/dev/null
kw-net
. /etc/os-release
# Tela limpa (sem sobras do boot) e as boas-vindas.
printf '\033[H\033[2J\033[3J'
printf '\033[1mBem-vindo ao mini-linux!\033[0m\n'
echo "Você está usando o $PRETTY_NAME ($(uname -m)), rodando direto no seu navegador."
printf 'Digite \033[1mcat README\033[0m para começar.\n\n'
action=0x4321fedc   # LINUX_REBOOT_CMD_POWER_OFF
trap 'action=0x4321fedc; stop=1' USR1
trap 'action=0x01234567; stop=1' USR2   # LINUX_REBOOT_CMD_RESTART
stop=
# A new session with the console as its controlling terminal, so the shell
# has job control and ^C reaches its foreground job.
cd /root
setsid -c /bin/bash -l <>/dev/console >&0 2>&0 &
shell=$!
while [ -z "$stop" ] && kill -0 $shell 2>/dev/null; do
	wait $shell
done
shutdown_now $action
EOF
# Network without iproute2 or a DHCP client (neither is in Ubuntu Base): lo,
# and eth0 with the fixed addresses of the host's user-mode network
# (js/core/net.ts: guest 10.0.2.15/24, gateway 10.0.2.2, DNS 10.0.2.3),
# set with the classic ioctls from perl (perl-base is Essential).
cat > "$stage/usr/local/sbin/kw-net" <<'EOF'
#!/usr/bin/perl
# unkernel: bring up lo, and eth0 as 10.0.2.15/24 via 10.0.2.2 if present.
use strict;
use warnings;
use Socket;
socket(my $s, AF_INET, SOCK_DGRAM, 0) or die "kw-net: socket: $!\n";
sub sin_ { pack("S n a4 x8", AF_INET, 0, inet_aton($_[0])) }
sub ifreq { pack("Z16 a24", $_[0], $_[1]) }
sub up {
	my ($if) = @_;
	my $r = ifreq($if, "");
	ioctl($s, 0x8913, $r) or die "kw-net: $if: $!\n";            # SIOCGIFFLAGS
	my $flags = unpack("x16 S", $r) | 0x41;                       # IFF_UP | IFF_RUNNING
	ioctl($s, 0x8914, ifreq($if, pack("S", $flags))) or die "kw-net: $if up: $!\n";
}
up("lo");
exit 0 unless -e "/sys/class/net/eth0";
ioctl($s, 0x8916, ifreq("eth0", sin_("10.0.2.15"))) or die "kw-net: address: $!\n";      # SIOCSIFADDR
ioctl($s, 0x891c, ifreq("eth0", sin_("255.255.255.0"))) or die "kw-net: netmask: $!\n"; # SIOCSIFNETMASK
up("eth0");
# struct rtentry (LP64): pad, dst, gateway, genmask, flags, ..., dev, ...
my $rt = pack("Q a16 a16 a16 S x6 Q Q s x6 Q Q Q S x6",
	0, sin_("0.0.0.0"), sin_("10.0.2.2"), sin_("0.0.0.0"), 0x3, 0, 0, 0, 0, 0, 0, 0); # RTF_UP|RTF_GATEWAY
ioctl($s, 0x890b, $rt) or $!{EEXIST} or die "kw-net: default route: $!\n";              # SIOCADDRT
EOF
for cmd in poweroff reboot halt; do
	cat > "$stage/usr/local/sbin/$cmd" <<EOF
#!/bin/sh
# unkernel: $cmd under /usr/local/sbin/kw-init; else the system's own.
if [ -e /run/kw-init ]; then
	trap 'exit 0' TERM   # kw-init stops everything: no "Terminated"
	kill -$([ $cmd = reboot ] && echo USR2 || echo USR1) 1
	sleep 10
	exit
fi
exec /usr/sbin/$cmd "\$@"
EOF
done
chmod 755 "$stage"/usr/local/sbin/{kw-init,kw-net,poweroff,reboot,halt}
ln -s ../local/sbin/kw-init "$stage/usr/sbin/init"

# TERM: the console starts as "linux"; the page's xterm.js and the CLI's
# host terminal are xterm-compatible.
printf '%s\n' 'case $TERM in linux|vt102|"") export TERM=xterm-256color ;; esac' > "$stage/etc/profile.d/kw-term.sh"

# Os arquivos do minicurso (ubuntu/rootfs/), por cima do sistema.
cp -a "$root/ubuntu/rootfs/." "$stage/"

# O instalador de pacotes, executado no guest depois que o disco existir.
mkdir -p "$stage/var/tmp/mini-linux"
cp "$root/ubuntu/packages.txt" "$root/ubuntu/install-packages.sh" "$stage/var/tmp/mini-linux/"

# --- image ------------------------------------------------------------------
img="$out/ubuntu.ext4"
state="$out/build"
mkdir -p "$state"
rm -f "$img.tmp"
truncate -s "$size" "$img.tmp"
# Inode tables and journal zeroed now (sparse, so free) rather than by the
# kernel's lazyinit thread after the first boot.
mke2fs -q -F -t ext4 -b 4096 -m 1 -L ubuntu \
	-E lazy_itable_init=0,lazy_journal_init=0,root_owner=0:0 \
	-d "$stage" "$img.tmp"
python3 "$root/ubuntu/ext4-owners.py" "$stage" "$UBUNTU_TARBALL" > "$state/owners.debugfs"
debugfs -w -f "$state/owners.debugfs" "$img.tmp" >/dev/null 2>"$state/owners.log" || {
	cat "$state/owners.log" >&2; exit 1; }
if grep -v '^debugfs ' "$state/owners.log" | grep -q .; then
	cat "$state/owners.log" >&2; exit 1
fi
e2fsck -fn "$img.tmp" >/dev/null 2>&1 || { e2fsck -fn "$img.tmp"; exit 1; }

# --- pacotes ----------------------------------------------------------------
# Dá boot no próprio disco com a CLI do unkernel (no Bun, rede user-mode
# sobre os sockets do host) e roda o apt do Ubuntu lá dentro. Sai com 0 no
# poweroff (deu certo) e 2 no reboot (falhou).
echo "pacotes: instalando ubuntu/packages.txt no guest (~1 min)..."
cli="$root/node_modules/unkernel/dist"
bun "$cli/cli.mjs" --kernel "$cli/unkernel-alpine.wasm" --initrd none --append "console=hvc0 root=/dev/wda rw" \
	--disk "$img.tmp" --mem 1024 --timeout 1800 \
	--input '{3}bash /var/tmp/mini-linux/install-packages.sh && rm -rf /var/tmp/mini-linux && sync && poweroff || reboot\n' \
	> "$state/packages.log" 2>&1 || {
	tail -40 "$state/packages.log" >&2
	echo "pacotes: falhou (log completo em $state/packages.log)" >&2
	exit 1
}
grep -a "mini-linux: pacotes instalados" "$state/packages.log" | tail -1
# Aplica o journal caso o desligamento não tenha deixado o fs limpo
# (0: nada a fazer, 1: corrigido), depois confere.
e2fsck -fy "$img.tmp" >/dev/null 2>&1 || [ $? -eq 1 ] || { e2fsck -fn "$img.tmp"; exit 1; }
e2fsck -fn "$img.tmp" >/dev/null 2>&1 || { e2fsck -fn "$img.tmp"; exit 1; }
mv "$img.tmp" "$img"
echo "disk: $img ($size, $(du -h "$img" | cut -f1) allocated)"
