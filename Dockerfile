FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
COPY encoded-assets ./encoded-assets
COPY decode-assets.mjs ./
RUN node decode-assets.mjs && rm -rf encoded-assets decode-assets.mjs
ENV NODE_ENV=production PORT=3000 SITE_MODE=staging
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
