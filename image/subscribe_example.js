const io = require('socket.io-client');
const jwt = require('jsonwebtoken');

if (process.argv.length < 4) {
    // Note: below assumes that EMS is served up via ui_nginx at /execution_monitor/api/v2/
    // execution_monitor path segment is provided via "path" parameter when creating IO socket client below.
    console.log('USAGE: node subscribe_example.js https://ingenium-ci.cld.jpl.nasa.gov/api/v2 execution-id')
    console.log('USAGE: node subscribe_example.js http://localhost/api/v2 execution-id')
    process.exit(0);
}

let websocket_url = process.argv[2];
console.log('websocket_url:', websocket_url);

let execution_id = process.argv[3];
console.log('execution_id:', execution_id);

var private_pem = process.env.PRIVATE_PEM || '';
if (private_pem == '') {
    console.log('PRIVATE_PEM is not defined');
    process.exit(0);
}

let username = process.env.USERNAME || 'hongmank';
let iat = new Date().getTime()/1000;
let exp = iat + (30*60);

let payload = {
    'scopes': ['execute:wsts', 'execute:testbed', 'execute:sit', 'admin'],
    'exp':exp,
    'iat':iat,
    'username': username
}

let sign_options = {'algorithm': 'RS256'}

let encoded_token = jwt.sign({'scopes': ['execute:wsts', 'execute:testbed', 'execute:sit', 'admin'],
    'exp':exp,
    'iat':iat,
    'username': username},
    private_pem,
    sign_options)

console.log('encoded_token:', encoded_token);    

let subscribe_url = `${websocket_url}/execution_event_subscribe`;
console.log('subscribe_url:', subscribe_url);

const socket = io(subscribe_url, {
    path: '/execution_monitor/socket.io',
    transport: ['websocket'],
    autoConnect: false,
    query: {token: encoded_token, execution_id: execution_id}
});

// console.log('socket:', socket);

socket.on('error', function (error) {
    console.log('error:', error);
});

// The event name of socket.io-client is 'connect' 
// while socket.io uses 'connection'.
socket.on('connect', function() {
  console.log('Connected to subscribe:');
});

socket.on('execution-event', function(msg) {
    console.log('execution-event:', JSON.stringify(msg, 0, 2));
});

socket.open();
console.log('call open');


