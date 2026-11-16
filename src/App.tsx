import { useEffect, useRef, useSyncExternalStore } from "react";
import { boot, focusTerminal, linuxStore, send, type Phase } from "./linux.ts";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Iniciando",
  download: "Baixando kernel",
  compile: "Compilando",
  boot: "Dando boot",
  running: "Rodando",
  stopped: "Parado",
  error: "Erro",
};

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export function App() {
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (termRef.current) void boot(termRef.current);
  }, []);

  return (
    <div className="app">
      <main className="stage" onClick={focusTerminal}>
        <div ref={termRef} className="term" />
      </main>
      <Bar />
    </div>
  );
}

function Bar() {
  const s = useSyncExternalStore(linuxStore.subscribe, linuxStore.get);
  const running = s.phase === "running";

  // Botões de mouse não devem roubar o foco do terminal.
  const act = (fn: () => void) => () => {
    fn();
    focusTerminal();
  };

  return (
    <footer className="bar">
      <span className="brand">
        <span className="faint">❯</span> <b>mini-linux</b>
      </span>
      <span className="seg on">0:console</span>

      <span className="spacer" />

      {running && (
        <>
          <span className="seg muted" title="Tempo desde o boot do kernel">
            up {formatUptime(s.uptimeMs)}
          </span>
          <span className="seg muted" title="Memória do guest">
            {s.memoryMiB} MiB
          </span>
          <span className="seg muted" title="Tamanho do terminal">
            {s.cols}×{s.rows}
          </span>
        </>
      )}

      <button type="button" className="seg btn" disabled={!running} onClick={act(() => send("\x0c"))} title="Limpar a tela (Ctrl-L)">
        limpar
      </button>
      <button type="button" className="seg btn" disabled={!running} onClick={act(() => send("poweroff\n"))} title="Desligar o guest">
        desligar
      </button>
      <button type="button" className="seg btn" onClick={() => location.reload()} title="Recarregar a página e dar boot de novo">
        reiniciar
      </button>

      <span className={`status ${s.phase}`} title={s.detail || PHASE_LABEL[s.phase]}>
        <span className="dot" />
        {PHASE_LABEL[s.phase]}
        {s.detail && s.phase !== "running" ? ` · ${s.detail}` : ""}
      </span>
    </footer>
  );
}
