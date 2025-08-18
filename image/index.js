var app = require('express')();
var http = require('http').Server(app);
var ping_timeout_secs = parseInt(process.env.PING_TIMEOUT_SECS)
if (isNaN(ping_timeout_secs)) {
  ping_timeout_secs = 30;
}

var ping_interval_secs = parseInt(process.env.PING_INTERVAL_SECS)
if (isNaN(ping_interval_secs)) {
  ping_interval_secs = 35;
}

var io = require('socket.io')(http, {pingTimeout: 1000*ping_timeout_secs, pingInterval: 1000*ping_interval_secs});

var winston = require('winston');
var util = require('util');
var jwt = require('jsonwebtoken');

var public_pem = process.env.PUBLIC_PEM || '';
var ems_secret = process.env.EMS_SECRET || '';

/**
 * format function for string.
 * Example:  'element id is {0}'.format(elem_id)
 */
String.prototype.format = function () {
  var args = arguments;
  return this.replace(/\{(\d+)\}/g, function (m, n) { return args[n]; });
};

var log = new (winston.Logger)({
  levels: {critical: 0, error: 1, warning: 2, info: 3, debug: 4, trace: 5},
  transports: [
    new (winston.transports.Console)({
      stderrLevels: [],   // send all logging to stdout to avoid the look of out of order logging
      timestamp: function() {
        return new Date().toISOString();
      },
      formatter: function(options) {
        // Return string will be passed to logger.
        return '[{0}]: [{1}] - {2}{3}'.format(options.level.toUpperCase(), 
            options.timestamp(), 
            options.message ? options.message : '', 
            options.meta && Object.keys(options.meta).length ? '\n\t'+ util.inspect(options.meta) : ''
        )
      }
    })
  ]
});

log.level = process.env.LOG_LEVEL != undefined ? process.env.LOG_LEVEL.toLowerCase() : 'debug';

log.info(`pingTimeout: ${io.eio.pingTimeout} pingInterval: ${io.eio.pingInterval}`);

var port = process.env.PORT || 3000;

app.get('/', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});

app.get('/api/v2/health', function(req, res) {
  let response =
  {
    'status' : 'OK',
    'message': ''
  };

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(response));
});

const io_em_pub = io.of('/api/v2/execution_event_publish');
const io_em_sub = io.of('/api/v2/execution_event_subscribe');


io_em_pub.use(function(socket, next) {
  // log.debug('io_em_pub socket.handshake.query:', socket.handshake.query);
  if (socket.handshake.query && socket.handshake.query.secret) {
    if (socket.handshake.query.secret == ems_secret) {
      next();
    } else {
      return next(new Error('Authentication error.'));
    }
  }  
})
.on('connection', function(socket) {
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

});

io_em_sub.use(function(socket, next) {
  // log.debug('io_em_sub socket.handshake.query:', socket.handshake.query);
  if (socket.handshake.query && socket.handshake.query.token) {
    try {
      jwt.verify(socket.handshake.query.token, public_pem, {algorithms: ['RS256']});
      log.info('jwt.verify ok');
      next();
    } catch (e) {
      log.error('jwt.verify error: %s', e);
      return next(new Error('Authentication error'));
    }
  } else {
      next(new Error('No authentication info was provided.'));
  }     
})
.on('connection', function(socket) {
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
});

http.listen(port, function() {
  log.info('listening on port: %s', port);
});