/**
 * Unit tests for the execution-monitor-service.
 *
 * All external collaborators (express, http, socket.io, winston, jsonwebtoken)
 * are mocked. No real network, filesystem or timer I/O occurs.
 */

jest.mock('express', () => jest.fn());
jest.mock('http', () => ({Server: jest.fn()}));
jest.mock('socket.io', () => ({Server: jest.fn()}));
jest.mock('winston', () => ({
  createLogger: jest.fn(),
  format: {
    combine: jest.fn((...parts) => ({combine: parts})),
    splat: jest.fn(() => ({splat: true})),
    timestamp: jest.fn((opts) => ({timestamp: opts})),
    printf: jest.fn((fn) => ({printf: fn}))
  },
  transports: {Console: jest.fn()}
}));
jest.mock('jsonwebtoken', () => ({verify: jest.fn(), sign: jest.fn()}));

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');
const jwt = require('jsonwebtoken');

const {
  createMockLogger,
  createMockSocket,
  createMockNamespace,
  createMockResponse
} = require('./mocks/testHelpers');

const index = require('../../index');

function createLoggerInstance() {
  return {
    critical: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn()
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  express.mockReturnValue({get: jest.fn()});
  http.Server.mockReturnValue({listen: jest.fn()});
  socketIo.Server.mockImplementation(() => ({
    of: jest.fn(() => ({
      use: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis()
    }))
  }));
  winston.createLogger.mockImplementation(() => createLoggerInstance());
});

describe('String.prototype.format', () => {
  test('substitutes positional arguments', () => {
    expect('element {0} and {1}'.format('a', 'b')).toBe('element a and b');
  });

  test('renders undefined for missing arguments', () => {
    expect('{0}'.format()).toBe('undefined');
  });
});

describe('parseTimeoutSecs', () => {
  test('returns the parsed integer for a numeric string', () => {
    expect(index.parseTimeoutSecs('42', 30)).toBe(42);
  });

  test('returns the default when the value is not a number', () => {
    expect(index.parseTimeoutSecs('not-a-number', 30)).toBe(30);
  });

  test('returns the default when the value is undefined', () => {
    expect(index.parseTimeoutSecs(undefined, 35)).toBe(35);
  });
});

describe('isoTimestamp', () => {
  test('returns an ISO-8601 formatted string', () => {
    expect(index.isoTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('formatLogMessage', () => {
  test('includes level, timestamp, message and inspected meta', () => {
    const info = {
      level: 'info',
      timestamp: '2020-01-01T00:00:00.000Z',
      message: 'hello',
      meta: {foo: 'bar'}
    };

    const result = index.formatLogMessage(info);

    expect(result).toContain('[INFO]');
    expect(result).toContain('2020-01-01T00:00:00.000Z');
    expect(result).toContain('hello');
    expect(result).toContain('foo');
  });

  test('omits message and meta when message is empty and meta is undefined', () => {
    const info = {
      level: 'debug',
      timestamp: 'TS',
      message: '',
      meta: undefined
    };

    expect(index.formatLogMessage(info)).toBe('[DEBUG]: [TS] - ');
  });

  test('omits meta when meta is an empty object', () => {
    const info = {
      level: 'warning',
      timestamp: 'TS',
      message: 'msg',
      meta: {}
    };

    expect(index.formatLogMessage(info)).toBe('[WARNING]: [TS] - msg');
  });
});

describe('createLogger', () => {
  test('configures winston with the extracted timestamp and printf formatter', () => {
    index.createLogger({});

    expect(winston.transports.Console).toHaveBeenCalledWith({stderrLevels: []});
    expect(winston.format.timestamp).toHaveBeenCalledWith({format: index.isoTimestamp});
    expect(winston.format.printf).toHaveBeenCalledWith(index.formatLogMessage);
    expect(winston.format.splat).toHaveBeenCalled();
    expect(winston.format.combine).toHaveBeenCalled();

    const config = winston.createLogger.mock.calls[0][0];
    expect(config.levels).toEqual({critical: 0, error: 1, warning: 2, info: 3, debug: 4, trace: 5});
    expect(config.transports).toHaveLength(1);
  });

  test('uses the lowercased LOG_LEVEL from the environment', () => {
    index.createLogger({LOG_LEVEL: 'INFO'});
    expect(winston.createLogger.mock.calls[0][0].level).toBe('info');
  });

  test('defaults the level to debug when LOG_LEVEL is not set', () => {
    index.createLogger({});
    expect(winston.createLogger.mock.calls[0][0].level).toBe('debug');
  });
});

describe('rootHandler', () => {
  test('sends the static index.html file', () => {
    const res = createMockResponse();

    index.rootHandler({}, res);

    expect(res.sendFile).toHaveBeenCalledTimes(1);
    expect(res.sendFile.mock.calls[0][0]).toMatch(/index\.html$/);
  });
});

describe('healthHandler', () => {
  test('responds with an OK JSON status', () => {
    const res = createMockResponse();

    index.healthHandler({}, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({status: 'OK', message: ''}));
  });
});

describe('createPubAuthMiddleware', () => {
  test('calls next without error when the secret matches', () => {
    const middleware = index.createPubAuthMiddleware('s3cret');
    const next = jest.fn();

    middleware({handshake: {query: {secret: 's3cret'}}}, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('calls next with an authentication error when the secret does not match', () => {
    const middleware = index.createPubAuthMiddleware('s3cret');
    const next = jest.fn();

    middleware({handshake: {query: {secret: 'wrong'}}}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toBe('Authentication error.');
  });

  test('does not call next when no secret is provided (documented behavior)', () => {
    const middleware = index.createPubAuthMiddleware('s3cret');
    const next = jest.fn();

    middleware({handshake: {query: {}}}, next);

    expect(next).not.toHaveBeenCalled();
  });
});

describe('createPubConnectionHandler', () => {
  let ns;
  let log;
  let socket;

  beforeEach(() => {
    ns = createMockNamespace();
    log = createMockLogger();
    socket = createMockSocket({query: {}, address: '10.0.0.1'});
    index.createPubConnectionHandler(ns, log)(socket);
  });

  test('logs the new connection and registers handlers', () => {
    expect(log.info).toHaveBeenCalledWith('io_em_pub new connection: %s', '10.0.0.1');
    expect(Object.keys(socket.handlers).sort()).toEqual(
      ['disconnect', 'execution-event', 'procedure-event'].sort()
    );
  });

  test('forwards an execution-event to the room matching execution_id', () => {
    const msg = {execution_id: 'exec-1', event: 'started', user_name: 'bob'};

    socket.emit('execution-event', msg);

    expect(ns.to).toHaveBeenCalledWith('exec-1');
    expect(ns.emit).toHaveBeenCalledWith('execution-event', msg);
  });

  test('warns when an execution-event has no execution_id', () => {
    socket.emit('execution-event', {event: 'started'});

    expect(ns.to).not.toHaveBeenCalled();
    expect(log.warning).toHaveBeenCalledWith('   io_em_pub execution_id was not specified.');
  });

  test('forwards a procedure-event to the procedure:version room', () => {
    const msg = {procedure_id: 'proc-1', version: '3', event: 'x', user_name: 'bob'};

    socket.emit('procedure-event', msg);

    expect(ns.to).toHaveBeenCalledWith('proc-1:3');
    expect(ns.emit).toHaveBeenCalledWith('procedure-event', msg);
  });

  test('warns when a procedure-event has no procedure_id', () => {
    socket.emit('procedure-event', {version: '3'});

    expect(ns.to).not.toHaveBeenCalled();
    expect(log.warning).toHaveBeenCalledWith('   io_em_pub procedure_id was not specified.');
  });

  test('logs on disconnect', () => {
    socket.emit('disconnect', 'transport close');

    expect(log.info).toHaveBeenCalledWith('io_em_pub socket disconnected. reason: %s', 'transport close');
  });
});

describe('createSubAuthMiddleware', () => {
  test('verifies the token and calls next without error', () => {
    jwt.verify.mockReturnValue({});
    const log = createMockLogger();
    const middleware = index.createSubAuthMiddleware('PEM', log);
    const next = jest.fn();

    middleware({handshake: {query: {token: 'tok'}}}, next);

    expect(jwt.verify).toHaveBeenCalledWith('tok', 'PEM', {algorithms: ['RS256']});
    expect(log.info).toHaveBeenCalledWith('jwt.verify ok');
    expect(next).toHaveBeenCalledWith();
  });

  test('calls next with an error when token verification fails', () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    const log = createMockLogger();
    const middleware = index.createSubAuthMiddleware('PEM', log);
    const next = jest.fn();

    middleware({handshake: {query: {token: 'tok'}}}, next);

    expect(log.error).toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toBe('Authentication error');
  });

  test('calls next with an error when no token is provided', () => {
    const log = createMockLogger();
    const middleware = index.createSubAuthMiddleware('PEM', log);
    const next = jest.fn();

    middleware({handshake: {query: {}}}, next);

    expect(jwt.verify).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].message).toBe('No authentication info was provided.');
  });
});

describe('createSubConnectionHandler', () => {
  function connect(query) {
    const log = createMockLogger();
    const socket = createMockSocket({query: query, address: '10.0.0.2'});
    index.createSubConnectionHandler(log)(socket);
    return {log: log, socket: socket};
  }

  test('joins the execution_id room provided at connection time', () => {
    const {log, socket} = connect({execution_id: 'exec-9'});

    expect(socket.join).toHaveBeenCalledWith('exec-9');
    expect(log.info).toHaveBeenCalledWith('    Init joining to execution_id: %s', 'exec-9');
  });

  test('warns when no execution_id is provided at connection time', () => {
    const {log, socket} = connect({});

    expect(socket.join).not.toHaveBeenCalled();
    expect(log.warning).toHaveBeenCalledWith('    Init execution_id was not provided.');
  });

  test('joins a room on set-execution-id with an id', () => {
    const {log, socket} = connect({});

    socket.emit('set-execution-id', {execution_id: 'later-1'});

    expect(socket.join).toHaveBeenCalledWith('later-1');
    expect(log.info).toHaveBeenCalledWith('    Later joining to execution_id: %s', 'later-1');
  });

  test('warns on set-execution-id without an id', () => {
    const {log, socket} = connect({});

    socket.emit('set-execution-id', {});

    expect(socket.join).not.toHaveBeenCalled();
    expect(log.warning).toHaveBeenCalledWith('    Later execution_id was not provided.');
  });

  test('joins the procedure:version room on set-procedure-id with an id', () => {
    const {log, socket} = connect({});

    socket.emit('set-procedure-id', {procedure_id: 'p1', version: '2'});

    expect(socket.join).toHaveBeenCalledWith('p1:2');
    expect(log.info).toHaveBeenCalledWith('    Later joining to room: %s', 'p1:2');
  });

  test('warns on set-procedure-id without an id', () => {
    const {log, socket} = connect({});

    socket.emit('set-procedure-id', {});

    expect(socket.join).not.toHaveBeenCalled();
    expect(log.warning).toHaveBeenCalledWith('    Later procedure_id was not provided.');
  });

  test('logs on connect', () => {
    const {log, socket} = connect({});

    socket.emit('connect');

    expect(log.info).toHaveBeenCalledWith('io_em_sub socket connected.');
  });

  test('logs on disconnect', () => {
    const {log, socket} = connect({});

    socket.emit('disconnect', 'ping timeout');

    expect(log.info).toHaveBeenCalledWith('io_em_sub socket disconnected. reason: %s', 'ping timeout');
  });
});

describe('createApp', () => {
  test('wires routes, namespaces and middleware with default timeouts', () => {
    const server = index.createApp({});

    expect(express).toHaveBeenCalledTimes(1);
    expect(http.Server).toHaveBeenCalledWith(server.app);
    expect(socketIo.Server).toHaveBeenCalledWith(server.http, {pingTimeout: 30000, pingInterval: 35000, maxHttpBufferSize: 5e9, allowEIO3: true, cors: {origin: true, methods: ['GET', 'POST']}});

    expect(server.app.get).toHaveBeenCalledWith('/', index.rootHandler);
    expect(server.app.get).toHaveBeenCalledWith('/api/v2/health', index.healthHandler);

    expect(server.io.of).toHaveBeenCalledWith('/api/v2/execution_event_publish');
    expect(server.io.of).toHaveBeenCalledWith('/api/v2/execution_event_subscribe');

    expect(server.io_em_pub.use).toHaveBeenCalledTimes(1);
    expect(server.io_em_pub.on).toHaveBeenCalledWith('connection', expect.any(Function));
    expect(server.io_em_sub.use).toHaveBeenCalledTimes(1);
    expect(server.io_em_sub.on).toHaveBeenCalledWith('connection', expect.any(Function));

    expect(server.log.info).toHaveBeenCalledWith('pingTimeout: 30000 pingInterval: 35000');
  });

  test('uses ping timeout/interval values from the environment', () => {
    index.createApp({PING_TIMEOUT_SECS: '5', PING_INTERVAL_SECS: '7'});

    expect(socketIo.Server).toHaveBeenCalledWith(expect.anything(), {pingTimeout: 5000, pingInterval: 7000, maxHttpBufferSize: 5e9, allowEIO3: true, cors: {origin: true, methods: ['GET', 'POST']}});
  });

  test('uses maxHttpBufferSize from the environment', () => {
    index.createApp({MAX_HTTP_BUFFER_SIZE: '20000000'});

    expect(socketIo.Server).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({maxHttpBufferSize: 20000000}));
  });

  test('falls back to process.env when no environment is provided', () => {
    const server = index.createApp();

    expect(server).toBeDefined();
    expect(express).toHaveBeenCalledTimes(1);
  });
});

describe('start', () => {
  test('listens on the default port and logs when ready', () => {
    const server = index.start({});

    expect(server.http.listen).toHaveBeenCalledWith(3000, expect.any(Function));

    const callback = server.http.listen.mock.calls[0][1];
    callback();
    expect(server.log.info).toHaveBeenCalledWith('listening on port: %s', 3000);
  });

  test('listens on the port from the environment', () => {
    const server = index.start({PORT: '4321'});

    expect(server.http.listen).toHaveBeenCalledWith('4321', expect.any(Function));
  });

  test('falls back to process.env when no environment is provided', () => {
    const server = index.start();

    expect(server.http.listen).toHaveBeenCalledTimes(1);
  });
});
