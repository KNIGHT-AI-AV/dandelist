# Built from the repo root so the workspace packages come along: docker build -f apps/api/Dockerfile .
# The base image comes from ECR Public, which has no anonymous pull limit for AWS builders.
FROM public.ecr.aws/docker/library/node:22-slim
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_ENV=production
RUN corepack enable
COPY . .
# The repo hoists for Expo; the isolated linker installs only what the API needs (about 20 packages, not 670).
RUN pnpm install --frozen-lockfile --prod --filter "@dandelist/api..." --config.node-linker=isolated
WORKDIR /app/apps/api
EXPOSE 8080
USER node
CMD ["node", "--import", "tsx", "src/server.ts"]
