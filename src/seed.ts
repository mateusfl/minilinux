// Arquivos que já aparecem no sistema logo após o boot.
//
// A imagem do Alpine não traz esses arquivos: assim como o unkernel.dev faz
// com o /root/README (web/src/readme.ts no repositório deles), escrevemos
// cada um no guest com vm.exec(), mandando o conteúdo pelo stdin. São
// arquivos reais do rootfs do guest (podem ser editados, apagados etc.), mas
// como não há disco persistente, são recriados a cada boot.
import type { KernelInstance } from "unkernel/web";

const FILES: Record<string, string> = {
  "/root/README": `Bem-vindo ao mini-linux
======================

Este é um kernel Linux 7.3 compilado para WebAssembly, rodando nesta aba
do browser. User space é Alpine Linux (riscv64). Você é root.

Este arquivo e a pasta ~/projetos foram criados pela página logo após o
boot (src/seed.ts).

Experimente:
  ls -la ~/projetos
  cat ~/projetos/notas.txt
  vi ~/projetos/notas.txt
`,
  "/root/projetos/notas.txt": `Minhas notas
------------
- arquivo criado pelo host (JavaScript) via vm.exec()
- pode editar à vontade: é um arquivo normal do guest
`,
};

// $1 é o caminho; o conteúdo chega pelo stdin.
const WRITE_SH = 'mkdir -p "$(dirname "$1")" && cat > "$1"';

export async function seedFiles(vm: KernelInstance) {
  for (const [path, content] of Object.entries(FILES)) {
    // exec() espera o user space do guest estar de pé antes de rodar.
    const r = await vm.exec("/bin/sh", ["-c", WRITE_SH, "sh", path], { input: content });
    if (r.exitCode !== 0) console.warn(`[seed] ${path}: ${r.stderr.trim() || `exit ${r.exitCode}`}`);
  }
}
