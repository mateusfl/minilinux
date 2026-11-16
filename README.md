# mini-linux

Um Ubuntu 24.04 LTS de verdade rodando no navegador, para a parte prática de
um minicurso de Linux. O kernel Linux 7.x compilado para WebAssembly vem do
[unkernel](https://github.com/pithings/unkernel); o app é Bun + TypeScript +
React.

```sh
bun install
bun run build:disk   # gera vendor/ubuntu.ext4 (~1 min; precisa de curl, e2fsprogs e python3)
bun dev              # http://localhost:3000
```

Precisa de um browser com JSPI (Chrome/Edge 137+, Firefox 153+, Safari 27+).
Tudo roda na aba de cada pessoa: o servidor só entrega arquivos estáticos.

## Peças

- `ubuntu/build.sh`: baixa o Ubuntu Base 24.04.5 riscv64 (SHA-256 fixado) e
  gera `vendor/ubuntu.ext4`, com um init mínimo que abre um `bash` de root no
  console. Adaptado do `kernel/guest/ubuntu-disk.sh` do unkernel.
- `ubuntu/packages.txt`: pacotes extras (nano, less, man...). O build dá boot
  no próprio disco com a CLI do unkernel, com rede, e roda o `apt` do Ubuntu
  lá dentro (`ubuntu/install-packages.sh`); só o repositório `main`. No
  navegador o sistema continua sem rede.
- `ubuntu/rootfs/`: copiado por cima do sistema no build; são os arquivos que
  já aparecem em `/root` (README, `projetos/notas.txt`). Mudou algo aqui, rode
  `bun run build:disk` de novo.
- `server.ts`: `Bun.serve` com o `index.html`, o kernel (`/unkernel.wasm`,
  direto de `node_modules/unkernel`) e o disco (`/ubuntu.ext4`, com Range
  requests: o navegador baixa só os blocos que o sistema lê).
- `src/linux.ts`: cria o terminal (`@wterm/dom`) e dá boot no kernel com o
  disco do Ubuntu como `/`. As escritas ficam só na memória, então cada carga
  da página começa limpa. Sem rede.
- `src/App.tsx`: o terminal ocupando a tela e a barra inferior.
