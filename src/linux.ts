// A ponte entre o kernel (unkernel) e o terminal (wterm).
//
// Só pode existir um kernel por thread, então o boot é um singleton de
// módulo: o React apenas lê o estado daqui (useSyncExternalStore) e entrega o
// elemento onde o terminal é desenhado.
import "@wterm/dom/src/terminal.css";
import { WTerm } from "@wterm/dom";
import { checkSupport, createKernel, type BootProgress, type KernelInstance } from "unkernel/web";
import { openUbuntuDisk, resetUbuntuDisk, type UbuntuDisk } from "./disk.ts";

export type Phase = "idle" | "download" | "compile" | "boot" | "running" | "stopped" | "error";

export interface LinuxState {
  phase: Phase;
  /** Texto curto do que está acontecendo (download em %, erro, motivo da parada). */
  detail: string;
  memoryMiB: number;
  uptimeMs: number;
  /** As mudanças no disco são salvas no navegador (null: disco ainda não aberto). */
  persistent: boolean | null;
  /** Por que não são salvas, quando não são. */
  diskNotice: string;
  /** Esta aba pode apagar o disco salvo (não está aberto em outra aba). */
  canReset: boolean;
}

let state: LinuxState = { phase: "idle", detail: "", memoryMiB: 0, uptimeMs: 0, persistent: null, diskNotice: "", canReset: false };
const listeners = new Set<() => void>();

function set(patch: Partial<LinuxState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const linuxStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

let vm: KernelInstance | null = null;
let term: WTerm | null = null;
let ubuntu: UbuntuDisk | null = null;
let started = false;
let restarting = false;

/** Manda bytes para o console do guest (o mesmo que digitar no terminal). */
export const send = (data: string | Uint8Array) => vm?.write(data);
export const focusTerminal = () => term?.focus();

/**
 * Pede ao kernel que grave o que está em cache nos discos persistentes e
 * espera o IndexedDB confirmar (no máximo 3 s). Não depende de nada no guest.
 */
const sync = () => (vm && state.phase === "running" ? vm.sync({ timeout: 3000 }) : Promise.resolve(true));

/** Reinicia o sistema recarregando a página; o disco salvo no navegador continua. */
export async function restart() {
  if (restarting) return;
  restarting = true;
  set({ detail: "salvando o disco" });
  await sync().catch(() => {});
  location.reload();
}

/** Apaga o disco salvo no navegador e reinicia: o sistema volta ao estado inicial. */
export async function restartClean() {
  if (restarting || !state.canReset) return;
  restarting = true;
  await resetUbuntuDisk(ubuntu);
  location.reload();
}

// Aba escondida ou fechando: grava o que estiver pendente.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void sync();
});
addEventListener("pagehide", () => void sync());

function onProgress(p: BootProgress) {
  if (p.stage === "download") {
    const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
    set({ phase: "download", detail: `${pct}%` });
  } else if (p.stage === "compile" || p.stage === "compiled") {
    set({ phase: "compile", detail: "" });
  } else if (p.stage === "memory") {
    set({ phase: "boot", detail: `${p.mib} MiB`, memoryMiB: p.mib });
  } else if (p.stage === "instantiate" || p.stage === "start") {
    set({ phase: "boot", detail: "" });
  }
}

/**
 * Linha de comando do kernel: o Ubuntu do disco como raiz. O resto faz o
 * disco chegar ao IndexedDB em ~2 s depois de cada escrita, em vez dos ~35 s
 * padrão: o journal do ext4 faz commit a cada 1 s e os dados sujos são
 * gravados depois de 1 s. Sem isso, um F5 logo depois de salvar um arquivo
 * o perderia (o navegador não espera um sync no pagehide).
 */
const CMDLINE = [
  "console=hvc0",
  "root=/dev/wda rootfstype=ext4 rw rootflags=commit=1",
  "sysctl.vm.dirty_expire_centisecs=100",
  "sysctl.vm.dirty_writeback_centisecs=100",
].join(" ");

/** Cria o terminal em `el` e dá boot no Linux. Chamadas repetidas são ignoradas. */
export async function boot(el: HTMLElement) {
  if (started) return;
  started = true;

  term = new WTerm(el, {
    scrollbackLines: 5000,
    cursorBlink: true,
    // O console do kernel (hvc) usa Ctrl-O como prefixo de SysRq e o engole;
    // dois seguidos chegam como um Ctrl-O de verdade (o "salvar" do nano).
    onData: (d) => send(d.replaceAll("\x0f", "\x0f\x0f")),
    onBinary: (d) => send(d),
    onResize: (cols, rows) => vm?.resize(cols, rows), // o programa em primeiro plano recebe SIGWINCH
  });
  // init() carrega o parser do wterm (um wasm pequeno); só então dá para escrever.
  await term.init();
  term.focus();

  try {
    const support = await checkSupport();
    if (!support.ok) throw new Error(`Navegador sem suporte: ${support.problems.join("; ")}`);

    // O disco do Ubuntu (vendor/ubuntu.ext4), lido sob demanda, com as
    // mudanças salvas no IndexedDB (disk.ts).
    ubuntu = await openUbuntuDisk();
    set({ persistent: ubuntu.persistent, diskNotice: ubuntu.notice ?? "", canReset: ubuntu.owner });
    if (ubuntu.notice) term.write(`\x1b[33m[disco] ${ubuntu.notice}\x1b[0m\r\n`);

    vm = await createKernel({
      kernel: "/unkernel.wasm", // servido pelo server.ts a partir de node_modules
      initrd: null, // ignora o Alpine embutido no kernel...
      disks: [ubuntu.disk], // ...e dá boot no Ubuntu, que vira /dev/wda
      cmdline: CMDLINE,
      // Sem `net`: o guest não tem rede.
      consoleSize: { cols: term.cols, rows: term.rows },
      onOutput: (bytes) => term?.write(bytes),
      onProgress,
    });
    // Para inspecionar pelo DevTools (ex.: `vm.stats()`).
    (globalThis as { vm?: KernelInstance }).vm = vm;
    set({ phase: "running", detail: "", memoryMiB: vm.memoryMiB });

    const timer = setInterval(() => set({ uptimeMs: vm?.stats().uptimeMs ?? 0 }), 1000);
    const exit = await vm.exited;
    clearInterval(timer);
    set({ phase: "stopped", detail: `${exit.kind} (${exit.code})` });
    term.write(`\r\n\x1b[2m[o kernel parou: ${exit.reason || exit.kind}]\x1b[0m\r\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    set({ phase: "error", detail: msg });
    term.write(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
  }
}
