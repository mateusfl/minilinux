# mini-linux: o app (Bun) e o disco do Ubuntu que ele serve.
#
#   docker build -t mini-linux .
#   docker run -p 3000:3000 mini-linux
#
# O build precisa de rede: baixa o Ubuntu Base e roda o apt dentro dele
# (ubuntu/build.sh, ~1 min).

# --- disco do Ubuntu -------------------------------------------------------
FROM oven/bun:1.4.4 AS disk
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates e2fsprogs python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
# Só o que gera o disco: mudanças no app não refazem esta etapa.
COPY ubuntu ./ubuntu
RUN bun run build:disk \
 # O disco é um arquivo esparso de 1 GB com ~200 MB de dados: o COPY entre
 # estágios o expandiria para 1 GB. Vai compactado (tar -S guarda os buracos)
 # e é extraído quando o container sobe.
 && tar -C vendor -cSzf vendor/ubuntu.ext4.tar.gz ubuntu.ext4

# --- app -------------------------------------------------------------------
FROM oven/bun:1.4.4-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json server.ts index.html ./
COPY src ./src
COPY --from=disk /app/vendor/ubuntu.ext4.tar.gz ./vendor/
EXPOSE 3000
# Extrai o disco (esparso de novo) na primeira subida do container. O tar
# mantém o mtime, então o ETag do disco (tamanho + mtime, server.ts) é o mesmo
# a cada container: os discos salvos nos navegadores continuam valendo até o
# próximo build.
CMD ["sh", "-c", "[ -f vendor/ubuntu.ext4 ] || tar -xSzf vendor/ubuntu.ext4.tar.gz -C vendor; exec bun server.ts"]
