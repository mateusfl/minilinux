#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
"""Emit debugfs commands that give an image built with `mke2fs -d` the
ownership and permissions of a root file system, without root privileges.

    ext4-owners.py STAGE_DIR [ROOTFS.tar.gz] > cmds; debugfs -w -f cmds image

`mke2fs -d` copies the (unprivileged) builder's uid/gid and its umask-filtered
modes. Every inode under STAGE_DIR becomes root:root; entries that appear in
the tarball get its exact mode (setuid bits included), uid and gid.
"""
import os
import stat
import sys
import tarfile


def quote(p):
    if '"' in p or "\n" in p:
        raise SystemExit(f"unsupported path {p!r}")
    return f'"{p}"'


def main():
    stage = sys.argv[1]
    tar = {}
    if len(sys.argv) > 2:
        with tarfile.open(sys.argv[2]) as t:
            for m in t.getmembers():
                name = "/" + m.name.lstrip("./").rstrip("/")
                tar[name if name != "/" else "/"] = m

    out = []
    for dirpath, dirnames, filenames in os.walk(stage):
        for name in [""] + dirnames + filenames:
            full = os.path.join(dirpath, name) if name else dirpath
            rel = "/" + os.path.relpath(full, stage).replace(os.sep, "/")
            if rel == "/.":
                rel = "/"
            st = os.lstat(full)
            ftype = stat.S_IFMT(st.st_mode)
            m = tar.get(rel)
            if m is not None:
                perm, uid, gid = m.mode & 0o7777, m.uid, m.gid
            else:
                perm, uid, gid = stat.S_IMODE(st.st_mode), 0, 0
            q = quote(rel)
            out.append(f"sif {q} uid {uid}")
            out.append(f"sif {q} gid {gid}")
            if ftype != stat.S_IFLNK:
                out.append(f"sif {q} mode 0{ftype | perm:o}")
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
