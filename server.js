const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Serve static files from the root directory so index.html is accessible
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    pingTimeout: 60000 
});

// --- DATA STORES ---
let activeDrivers = {}; 
let activePatients = {};
let activeCommuters = {}; 

// --- CONFIGURATION ---
const METERS_PER_MINUTE = 600;  // Avg emergency speed

// --- MATH: Haversine Formula ---
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return Math.round(R * 2 * Math.atan2(math.sqrt(a), math.sqrt(1-a)));
}

// --- LOGIC: VIRTUAL GREEN CORRIDOR ---
function runVirtualCorridor(driverId) {
    const driver = activeDrivers[driverId];
    if (!driver || driver.status !== 'busy') return;

    Object.keys(activeCommuters).forEach(cid => {
        const commuter = activeCommuters[cid];
        const dist = getDistance(driver.lat, driver.lng, commuter.lat, commuter.lng);

        // Layer 1: Immediate Warning (Radius 300m)
        if (dist < 300) {
            io.to(cid).emit('VIRTUAL_SIGNAL', { 
                type: 'RED', 
                msg: 'AMBULANCE BEHIND YOU! MOVE LEFT & STOP NOW.' 
            });
        } 
        // Layer 2: Long-Range Pre-Clearing (300m to 3km)
        else if (dist < 3000) {
            io.to(cid).emit('VIRTUAL_SIGNAL', { 
                type: 'YELLOW', 
                msg: 'EMERGENCY CORRIDOR ACTIVE AHEAD. VACATE CENTER LANE.' 
            });
        }
    });
}

// --- SOCKET CONNECTION HUB ---
io.on('connection', (socket) => {
    console.log('Device Connected:', socket.id);

    socket.on('register', (data) => {
        if (data.role === 'driver') {
            activeDrivers[socket.id] = { ...data, status: 'available' };
        } else if (data.role === 'commuter') {
            activeCommuters[socket.id] = data;
        } else if (data.role === 'patient') {
            activePatients[socket.id] = data;
        }
    });

    socket.on('telemetry', (data) => {
        if (activeDrivers[socket.id]) {
            activeDrivers[socket.id].lat = data.lat;
            activeDrivers[socket.id].lng = data.lng;
            
            // Activate Corridor if mission is active
            if (activeDrivers[socket.id].status === 'busy') {
                runVirtualCorridor(socket.id);
            }
        } else if (activeCommuters[socket.id]) {
            activeCommuters[socket.id].lat = data.lat;
            activeCommuters[socket.id].lng = data.lng;
        }
    });

    socket.on('EMERGENCY_TRIGGER', (coords) => {
        activePatients[socket.id] = { lat: coords.lat, lng: coords.lng };
        // Trigger for all available drivers
        io.emit('DISPATCH_INVITE', { pLat: coords.lat, pLng: coords.lng }, (response) => {
            if (response && response.accepted) {
                activeDrivers[socket.id].status = 'busy';
            }
        });
    });

    socket.on('disconnect', () => {
        delete activeDrivers[socket.id];
        delete activeCommuters[socket.id];
        delete activePatients[socket.id];
    });
});

// --- RENDER PORT BINDING ---
// This is the critical fix for "Exited with status 1"
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`RescuePath Node Server Live on Port ${PORT}`);
});
