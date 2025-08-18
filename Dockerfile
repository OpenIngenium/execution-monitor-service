FROM cae-artifactory.jpl.nasa.gov:17001/node:12.22.1
WORKDIR /app
COPY ./image /app
RUN npm ci
USER node
# CMD pwd && ls -l && npm start
CMD npm start

