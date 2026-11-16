# mini-linux

PoC: um Linux de verdade (kernel 7.x compilado para WebAssembly pelo
[unkernel](https://github.com/pithings/unkernel), com Alpine riscv64) rodando
no browser, com Bun + TypeScript + React.

```sh
bun install
bun dev        # http://localhost:3000
```

Precisa de um browser com JSPI (Chrome/Edge 137+, Firefox 153+, Safari 27+).

## Peças

- `server.ts`: `Bun.serve` com o `index.html` (bundler do Bun) e a rota
  `/unkernel-alpine.wasm`, que entrega o kernel direto de `node_modules/unkernel`.
- `src/linux.ts`: singleton que cria o terminal (`@wterm/dom`) e dá boot no
  kernel (`createKernel` de `unkernel/web`). Liga `onOutput → term.write` e
  `term.onData → vm.write`, e expõe o estado para o React.
- `src/App.tsx`: o terminal ocupando a tela e a barra inferior (status, uptime,
  memória, tamanho, limpar/desligar/reiniciar).

No DevTools, `vm` é a instância do kernel: `await vm.exec("uname", ["-a"])`.
