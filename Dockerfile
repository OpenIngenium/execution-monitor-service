FROM node:24.22.1-slim
WORKDIR /app
COPY ./image /app
RUN npm ci --omit=dev
USER node
CMD ["npm", "start"]

