var express = require('express');
var httpModule = require('http');
var socketIo = require('socket.io');
var winston = require('winston');
var util = require('util');
var jwt = require('jsonwebtoken');

/**
 * format function for string.
 * Example:  'element id is {0}'.format(elem_id)
 */
String.prototype.format = function () {
  var args = arguments;
  return this.replace(/\{(\d+)\}/g, function (m, n) { return args[n]; });
};

/**
 * Parse an integer timeout/interval value, falling back to a default when the
 * value is missing or not a number.
 */
function parseTimeoutSecs(value, defaultValue) {
  var parsed = parseInt(value);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Timestamp function used by the winston Console transport.
 */
function isoTimestamp() {
  return new Date().toISOString();
}

/**
 * Formatter (winston 3 printf) used by the Console transport.
 * The `info` object is produced by the format pipeline (splat + timestamp).
 * Return string will be passed to logger.
 */
function formatLogMessage(info) {
  return '[{0}]: [{1}] - {2}{3}'.format(info.level.toUpperCase(),
      info.timestamp,
      info.message ? info.message : '',
      info.meta && Object.keys(info.meta).length ? '\n\t' + util.inspect(info.meta) : ''
  );
}

/**
 * Create the application logger. Log level is read from LOG_LEVEL (lowercased)
 * and defaults to 'debug'.
 */
function createLogger(env) {
  var log = winston.createLogger({
    levels: {critical: 0, error: 1, warning: 2, info: 3, debug: 4, trace: 5},
    level: env.LOG_LEVEL != undefined ? env.LOG_LEVEL.toLowerCase() : 'debug',
    format: winston.format.combine(
      winston.format.splat(),
      winston.format.timestamp({format: isoTimestamp}),
      winston.format.printf(formatLogMessage)
    ),
    transports: [
      new winston.transports.Console({
        stderrLevels: []   // send all logging to stdout to avoid the look of out of order logging
      })
    ]
  });

  return log;
}

/**
 * GET / handler - serves the static index page.
 */
function rootHandler(req, res) {
  res.sendFile(__dirname + '/index.html');
}

/**
 * GET /api/v2/health handler.
 */
function healthHandler(req, res) {
  let response =
  {
    'status' : 'OK',
    'message': ''
  };

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(response));
}

/**
 * Authentication middleware for the publish namespace.
 */
function createPubAuthMiddleware(emsSecret) {
  return function(socket, next) {
    if (socket.handshake.query && socket.handshake.query.secret) {
      if (socket.handshake.query.secret == emsSecret) {
        next();
      } else {
        return next(new Error('Authentication error.'));
      }
    }
  };
}

/**
 * Connection handler for the publish namespace.
 */
function createPubConnectionHandler(io_em_sub, log) {
  return function(socket) {
    log.info('io_em_pub new connection: %s', socket.handshake.address);

    socket.on('execution-event', function(msg) {
      log.debug('execution-event execution_id: %s event: %s user_name: %s', msg.execution_id, msg.event, msg.user_name);
      log.trace('execution-event msg: %s', JSON.stringify(msg));
      let execution_id = msg.execution_id;

      if (execution_id) {
        log.debug('   io_em_pub sends to room: %s', execution_id);
        io_em_sub.to(execution_id).emit('execution-event', msg);
      } else {
        log.warning('   io_em_pub execution_id was not specified.');
      }
    });

    socket.on('procedure-event', function(msg) {
      log.debug('procedure-event procedure_id: %s version: %s event: %s user_name: %s',
        msg.procedure_id, msg.version, msg.event, msg.user_name);
      let procedure_id = msg.procedure_id;
      let version = msg.version;

      if (procedure_id) {
        let room = `${procedure_id}:${version}`;
        log.debug('   io_proc_pub sends to room: %s', room);
        io_em_sub.to(room).emit('procedure-event', msg);
      } else {
        log.warning('   io_em_pub procedure_id was not specified.');
      }
    });

    socket.on('disconnect', function(reason) {
        log.info('io_em_pub socket disconnected. reason: %s', reason);
    });
  };
}

/**
 * Authentication middleware for the subscribe namespace.
 */
function createSubAuthMiddleware(publicPem, log) {
  return function(socket, next) {
    if (socket.handshake.query && socket.handshake.query.token) {
      try {
        jwt.verify(socket.handshake.query.token, publicPem, {algorithms: ['RS256']});
        log.info('jwt.verify ok');
        next();
      } catch (e) {
        log.error('jwt.verify error: %s', e);
        return next(new Error('Authentication error'));
      }
    } else {
        next(new Error('No authentication info was provided.'));
    }
  };
}

/**
 * Connection handler for the subscribe namespace.
 */
function createSubConnectionHandler(log) {
  return function(socket) {
    log.info('io_em_sub new connection. address: %s', socket.handshake.address);

    let execution_id = null;
    if (socket.handshake.query.execution_id) {
      execution_id = socket.handshake.query.execution_id;
      log.info('    Init joining to execution_id: %s', execution_id);
      socket.join(execution_id)
    } else {
      log.warning('    Init execution_id was not provided.');
    }

    socket.on('set-execution-id', function(data) {
      if (data.execution_id) {
        log.info('    Later joining to execution_id: %s', data.execution_id);
        socket.join(data.execution_id)
      } else {
        log.warning('    Later execution_id was not provided.');
      }
    });

    socket.on('set-procedure-id', function(data) {
      if (data.procedure_id) {
        let room = `${data.procedure_id}:${data.version}`;
        log.info('    Later joining to room: %s', room);
        socket.join(room)
      } else {
        log.warning('    Later procedure_id was not provided.');
      }
    });

    socket.on('connect', function() {
      log.info('io_em_sub socket connected.');
    });

    socket.on('disconnect', function(reason) {
        log.info('io_em_sub socket disconnected. reason: %s', reason);
    });
  };
}

/**
 * Build the Express app, HTTP server and Socket.IO namespaces with all
 * middleware and event handlers wired up.
 */
function createApp(env) {
  env = env || process.env;

  var app = express();
  var http = httpModule.Server(app);

  var ping_timeout_secs = parseTimeoutSecs(env.PING_TIMEOUT_SECS, 30);
  var ping_interval_secs = parseTimeoutSecs(env.PING_INTERVAL_SECS, 35);

  var ping_timeout_ms = 1000 * ping_timeout_secs;
  var ping_interval_ms = 1000 * ping_interval_secs;

  // Socket.IO defaults maxHttpBufferSize to 1e6 (1MB). Large execution/procedure
  // events (e.g. import_procedure_section results embedding many elements) can
  // exceed this, causing the transport to be forcibly closed ("transport error")
  // and the event to be dropped. Allow overriding via env, default to 5GB.
  var max_http_buffer_size = parseTimeoutSecs(env.MAX_HTTP_BUFFER_SIZE, 5e9);

  // Socket.IO v3+ no longer allows all origins by default. Allow all origins
  // (reflecting the request origin) to restore the previous permissive behavior.
  // allowEIO3 keeps backward compatibility with existing Socket.IO v2 clients.
  var io = new socketIo.Server(http, {
    pingTimeout: ping_timeout_ms,
    pingInterval: ping_interval_ms,
    maxHttpBufferSize: max_http_buffer_size,
    allowEIO3: true,
    cors: {
      origin: true,
      methods: ['GET', 'POST']
    }
  });

  var log = createLogger(env);

  var public_pem = env.PUBLIC_PEM || '';
  var ems_secret = env.EMS_SECRET || '';

  log.info(`pingTimeout: ${ping_timeout_ms} pingInterval: ${ping_interval_ms}`);

  app.get('/', rootHandler);
  app.get('/api/v2/health', healthHandler);

  const io_em_pub = io.of('/api/v2/execution_event_publish');
  const io_em_sub = io.of('/api/v2/execution_event_subscribe');

  io_em_pub.use(createPubAuthMiddleware(ems_secret))
    .on('connection', createPubConnectionHandler(io_em_sub, log));

  io_em_sub.use(createSubAuthMiddleware(public_pem, log))
    .on('connection', createSubConnectionHandler(log));

  return {app: app, http: http, io: io, log: log, io_em_pub: io_em_pub, io_em_sub: io_em_sub};
}

/**
 * Start the HTTP server.
 */
function start(env) {
  env = env || process.env;
  var server = createApp(env);
  var port = env.PORT || 3000;

  server.http.listen(port, function() {
    server.log.info('listening on port: %s', port);
  });

  return server;
}

module.exports = {
  parseTimeoutSecs: parseTimeoutSecs,
  isoTimestamp: isoTimestamp,
  formatLogMessage: formatLogMessage,
  createLogger: createLogger,
  rootHandler: rootHandler,
  healthHandler: healthHandler,
  createPubAuthMiddleware: createPubAuthMiddleware,
  createPubConnectionHandler: createPubConnectionHandler,
  createSubAuthMiddleware: createSubAuthMiddleware,
  createSubConnectionHandler: createSubConnectionHandler,
  createApp: createApp,
  start: start
};

/* istanbul ignore if */
if (require.main === module) {
  start(process.env);
}