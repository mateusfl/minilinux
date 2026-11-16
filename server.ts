import index from "./index.html";

// O kernel vem pronto no pacote npm `unkernel`. Servimos o arquivo numa rota
// explícita em vez de depender do bundler do Bun emitir o asset referenciado
// por `new URL(..., import.meta.url)` no SDK. (O Alpine embutido nele não é
// usado: o boot é do disco do Ubuntu abaixo.)
const kernel = Bun.file(Bun.resolveSync("unkernel/alpine.wasm", import.meta.dir));

// O disco do Ubuntu, gerado por `bun run build:disk` (ubuntu/build.sh).
const diskPath = new URL("./vendor/ubuntu.ext4", import.meta.url);
if (!(await Bun.file(diskPath).exists())) {
  console.error("vendor/ubuntu.ext4 não existe: rode `bun run build:disk` antes.");
  process.exit(1);
}

/**
 * O SDK lê o disco sob demanda, em pedaços, com Range requests (só os blocos
 * que o guest toca são baixados): responde 206 com o trecho pedido.
 */
function serveDisk(req: Request) {
  // Lido a cada pedido: um `build:disk` com o servidor no ar troca o arquivo.
  const disk = Bun.file(diskPath);
  // O navegador guarda as mudanças do aluno como um overlay sobre ESTA imagem;
  // o ETag a identifica, e o SDK descarta o overlay quando ele muda.
  const etag = `"${disk.size.toString(16)}-${disk.lastModified.toString(16)}"`;
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const headers = { "accept-ranges": "bytes", etag, "cache-control": "no-cache" };
  if (!m) return new Response(disk, { headers });
  const start = Number(m[1]);
  const end = Math.min(m[2] ? Number(m[2]) : disk.size - 1, disk.size - 1);
  if (start > end) {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${disk.size}` } });
  }
  return new Response(disk.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${disk.size}` },
  });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: { hmr: false, console: true },
  routes: {
    "/": index,
    "/unkernel.wasm": () => new Response(kernel, { headers: { "content-type": "application/wasm" } }),
    "/ubuntu.ext4": serveDisk,
  },
});

console.log(`mini-linux em ${server.url}`);
