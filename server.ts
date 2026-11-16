import index from "./index.html";

// O kernel (Linux + Alpine embutido) vem pronto no pacote npm `unkernel`.
// Servimos o arquivo numa rota explícita em vez de depender do bundler do Bun
// emitir o asset referenciado por `new URL(..., import.meta.url)` no SDK.
const kernel = Bun.file(Bun.resolveSync("unkernel/alpine.wasm", import.meta.dir));

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: { hmr: false, console: true },
  routes: {
    "/": index,
    "/unkernel-alpine.wasm": () =>
      new Response(kernel, { headers: { "content-type": "application/wasm" } }),
  },
});

console.log(`mini-linux em ${server.url}`);
