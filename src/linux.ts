// A ponte entre o kernel (unkernel) e o terminal (wterm).
//
// Só pode existir um kernel por thread, então o boot é um singleton de
// módulo: o React apenas lê o estado daqui (useSyncExternalStore) e entrega o
// elemento onde o terminal é desenhado.
import "@wterm/dom/src/terminal.css";
import { WTerm } from "@wterm/dom";
import { checkSupport, createKernel, openHttpDisk, type BootProgress, type KernelInstance } from "unkernel/web";

export type Phase = "idle" | "download" | "compile" | "boot" | "running" | "stopped" | "error";

export interface LinuxState {
  phase: Phase;
  /** Texto curto do que está acontecendo (download em %, erro, motivo da parada). */
  detail: string;
  memoryMiB: number;
  uptimeMs: number;
}

let state: LinuxState = { phase: "idle", detail: "", memoryMiB: 0, uptimeMs: 0 };
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
let started = false;

/** Manda bytes para o console do guest (o mesmo que digitar no terminal). */
export const send = (data: string | Uint8Array) => vm?.write(data);
export const focusTerminal = () => term?.focus();

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

    // O disco do Ubuntu (vendor/ubuntu.ext4), lido sob demanda. As escritas
    // ficam só na memória (persist: false): cada carga da página começa limpa.
    const ubuntu = await openHttpDisk("/ubuntu.ext4", { persist: false });

    vm = await createKernel({
      kernel: "/unkernel.wasm", // servido pelo server.ts a partir de node_modules
      initrd: null, // ignora o Alpine embutido no kernel...
      disks: [ubuntu], // ...e dá boot no Ubuntu, que vira /dev/wda
      cmdline: "console=hvc0 root=/dev/wda rw",
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
