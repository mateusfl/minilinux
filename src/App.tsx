import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { boot, focusTerminal, linuxStore, send, type Phase } from "./linux.ts";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Iniciando",
  download: "Baixando kernel",
  compile: "Compilando",
  boot: "Dando boot",
  running: "Rodando",
  stopped: "Desligado",
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

/** Ícones de 14 px em traço, na cor do texto. */
const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const ClearIcon = () => <Icon><path d="M4 6h16M4 12h10M4 18h6" /><path d="m16 16 5 5m0-5-5 5" /></Icon>;
const PowerIcon = () => <Icon><path d="M12 3v9" /><path d="M6.3 7.5a8 8 0 1 0 11.4 0" /></Icon>;
const RestartIcon = () => <Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Icon>;

function Button({ icon, children, title, disabled, onClick }: {
  icon: ReactNode; children: ReactNode; title: string; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn"
      title={title}
      disabled={disabled}
      // Clique de mouse não deve tirar o foco do terminal.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClick();
        focusTerminal();
      }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function Bar() {
  const s = useSyncExternalStore(linuxStore.subscribe, linuxStore.get);
  const running = s.phase === "running";

  return (
    <footer className="bar">
      <div className="brand">
        <span className="faint">❯</span>
        <b>mini-linux</b>
        <span className="tag">Ubuntu 24.04</span>
      </div>

      <span className={`status ${s.phase}`} title={s.detail || PHASE_LABEL[s.phase]}>
        <span className="dot" />
        {PHASE_LABEL[s.phase]}
        {s.detail && s.phase !== "running" ? ` · ${s.detail}` : ""}
      </span>
      {running && (
        <span className="info">
          <span title="Tempo desde o boot do kernel">up {formatUptime(s.uptimeMs)}</span>
          <span title="Memória do sistema">{s.memoryMiB} MiB</span>
        </span>
      )}

      <div className="actions">
        <Button icon={<ClearIcon />} title="Limpar a tela (Ctrl-L)" disabled={!running} onClick={() => send("\x0c")}>
          Limpar
        </Button>
        <Button icon={<PowerIcon />} title="Desligar o sistema (poweroff)" disabled={!running} onClick={() => send("poweroff\n")}>
          Desligar
        </Button>
        <Button icon={<RestartIcon />} title="Recarregar a página: o sistema volta ao estado inicial" onClick={() => location.reload()}>
          Reiniciar
        </Button>
      </div>
    </footer>
  );
}
