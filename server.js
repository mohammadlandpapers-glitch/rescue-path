const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" } 
});

let activeDrivers = {};

io.on('connection', (socket) => {
    console.log('Device Connected:', socket.id);

    socket.on('register', (data) => {
        if (data.role === 'driver') {
            activeDrivers[socket.id] = { ...data, status: 'available' };
            console.log(`Driver Registered: ${socket.id}`);
        }
    });

    socket.on('EMERGENCY_TRIGGER', (coords) => {
        console.log('🚨 SOS via Socket:', coords);
        io.emit('DISPATCH_INVITE', coords);
    });

    socket.on('accept_mission', (data) => {
        if (activeDrivers[socket.id]) {
            activeDrivers[socket.id].status = 'busy';
            console.log(`Driver ${socket.id} (AMB-TELE-108) is now BUSY.`);
        }
    });

    socket.on('disconnect', () => {
        console.log('Device Disconnected:', socket.id);
        delete activeDrivers[socket.id];
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`RescuePath Node Server Live on Port ${PORT}`);
});
