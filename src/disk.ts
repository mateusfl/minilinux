// O disco do Ubuntu com persistência no navegador, como o unkernel.dev faz
// (web/src/data.ts no repositório deles).
//
// A imagem (vendor/ubuntu.ext4) vem do servidor, lida sob demanda; tudo o que
// o guest escreve vai para um overlay copy-on-write salvo no IndexedDB a cada
// flush do ext4. Na próxima carga o overlay é aplicado por cima da imagem.
// Se a imagem mudar (outro build no deploy), o SDK descarta o overlay, que não
// serviria para ela.
import { openHttpDisk, resetHttpDisk, type CowDisk } from "unkernel/web";

const DISK_URL = "/ubuntu.ext4";
const STORE_NAME = "mini-linux:ubuntu";

export interface UbuntuDisk {
  disk: CowDisk;
  /** As mudanças são salvas no navegador. */
  persistent: boolean;
  /** Por que não são, quando não são. */
  notice?: string;
  /** Esta aba é a dona do disco salvo (pode apagá-lo). */
  owner: boolean;
}

/**
 * Só uma aba por vez pode escrever no disco salvo (duas o corromperiam):
 * Web Locks em contextos seguros (https, localhost); senão uma sondagem por
 * BroadcastChannel (http puro na rede, ex.: a VPS sem TLS).
 */
function acquireLock(): Promise<boolean> {
  const key = `${STORE_NAME}:lock`;
  if (navigator.locks?.request) {
    return new Promise((resolve) => {
      navigator.locks
        .request(key, { ifAvailable: true }, (lock) => {
          resolve(!!lock);
          // Segurado até a página ir embora.
          return lock ? new Promise<void>(() => {}) : undefined;
        })
        .catch(() => resolve(probeLock(key)));
    });
  }
  return probeLock(key);
}

async function probeLock(key: string): Promise<boolean> {
  if (typeof BroadcastChannel !== "function") return true;
  const ch = new BroadcastChannel(key);
  let held = false;
  let taken = false;
  ch.onmessage = (e: MessageEvent) => {
    if (e.data === "held") taken = true;
    else if (e.data === "probe" && held) ch.postMessage("held");
  };
  ch.postMessage("probe");
  await new Promise((r) => setTimeout(r, 300));
  if (taken) {
    ch.close();
    return false;
  }
  held = true; // o canal fica aberto e responde às sondagens enquanto a página viver
  return true;
}

export async function openUbuntuDisk(): Promise<UbuntuDisk> {
  const memory = async (notice: string, owner: boolean): Promise<UbuntuDisk> => ({
    disk: await openHttpDisk(DISK_URL, { persist: false }),
    persistent: false,
    notice,
    owner,
  });

  if (typeof indexedDB === "undefined") return memory("este navegador não tem IndexedDB", false);
  if (!(await acquireLock())) return memory("aberto em outra aba: as mudanças desta não são salvas", false);

  // Pede para o navegador não apagar o disco sozinho quando faltar espaço.
  void navigator.storage?.persist?.().catch(() => {});

  try {
    const disk = await openHttpDisk(DISK_URL, {
      name: STORE_NAME,
      onError: (e) => console.error("[disco] falha ao salvar:", e),
    });
    return { disk, persistent: true, owner: true };
  } catch (e) {
    // IndexedDB recusado (navegação privada, armazenamento bloqueado).
    console.error("[disco] sem persistência:", e);
    return memory("o navegador recusou o IndexedDB: as mudanças não são salvas", true);
  }
}

/** Para de salvar (as próximas escritas do guest se perdem) e apaga o disco salvo. */
export async function resetUbuntuDisk(d: UbuntuDisk | null) {
  if (d) {
    d.disk.detach();
    await d.disk.saving?.catch(() => {});
    await d.disk.store?.close?.();
  }
  await resetHttpDisk(STORE_NAME);
}
