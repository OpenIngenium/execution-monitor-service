FROM cae-artifactory.jpl.nasa.gov:17001/node:24.18.1
WORKDIR /app
COPY ./image /app
RUN npm ci --omit=dev
USER node
CMD ["npm", "start"]

