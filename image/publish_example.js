const io = require('socket.io-client');

function sleep(msec) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

if (process.argv.length < 3) {
    // Note: below assumes that EMS is served up via ui_nginx at /execution_monitor/api/v2/
    // execution_monitor path segment is provided via "path" parameter when creating IO socket client below.    
    console.log('USAGE: node publish_example.js https://ingenium-ci.cld.jpl.nasa.gov/api/v2')
    console.log('USAGE: node publish_example.js http://localhost/api/v2')
    process.exit(0);
}

let websocket_url = process.argv[2];
console.log('websocket_url:', websocket_url);

var private_pem = process.env.PRIVATE_PEM || '';
if (private_pem == '') {
    console.log('PRIVATE_PEM is not defined');
    process.exit(0);
}

var ems_secret = process.env.EMS_SECRET || '';
if (ems_secret == '') {
    console.log('EMS_SECRET is not defined');
    process.exit(0);
}

let publish_url = `${websocket_url}/execution_event_publish`;
console.log('publish_url:', publish_url);

const socket = io(publish_url, {
    path: '/execution_monitor/socket.io',
    transport: ['websocket'],
    autoConnect: false,
    query: {secret: ems_secret}
});

// console.log('socket:', socket);

socket.on('error', function (error) {
    console.log('error:', error);
});

// The event name of socket.io-client is 'connect' 
// while socket.io uses 'connection'.
socket.on('connect', function() {
  console.log('Connected to publish:');
});

socket.open();
console.log('call open');

for (let i=0; i < 100; i++) {
    sleep(2000);    // two seconds
    
    let msg1 = 'hi ' + i;
    console.log('emit msg1:', msg1);
    socket.emit('execution-event', {execution_id: 'id_1', msg: msg1});

    let msg2 = 'ho ' + i;
    console.log('emit msg2:', msg2);    
    socket.emit('execution-event', {execution_id: 'id_2', msg: msg2});
}
process.exit(0);

