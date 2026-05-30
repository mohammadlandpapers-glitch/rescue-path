const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
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
const GOVT_TIME_THRESHOLD = 15; // Minutes: When to trigger 'Smart Choice'
const METERS_PER_MINUTE = 600;  // Average emergency speed in urban areas

// --- MATH ENGINE: Haversine Formula ---
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// --- LOGIC: DUAL-LAYER VIRTUAL GREEN CORRIDOR ---
// This runs the moment an ambulance is 'busy' on a mission
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
        // Layer 2: Long-Range Pre-Clearing (Radius 300m to 3km)
        else if (dist < 3000) {
            io.to(cid).emit('VIRTUAL_SIGNAL', { 
                type: 'YELLOW', 
                msg: 'EMERGENCY CORRIDOR ACTIVE AHEAD. VACATE CENTER LANE.' 
            });
        }
    });
}

// --- LOGIC: SMART CHOICE & WATERFALL DISPATCH ---
async function processEmergencyRequest(pId, pLat, pLng) {
    let drivers = Object.keys(activeDrivers).map(id => ({ id, ...activeDrivers[id] }))
                  .filter(d => d.status === 'available');

    // Sort by type and distance
    let govUnits = drivers.filter(d => d.type === 'government').sort((a,b) => getDistance(pLat, pLng, a.lat, a.lng) - getDistance(pLat, pLng, b.lat, b.lng));
    let pvtUnits = drivers.filter(d => d.type === 'private').sort((a,b) => getDistance(pLat, pLng, a.lat, a.lng) - getDistance(pLat, pLng, b.lat, b.lng));

    const closestGov = govUnits[0];
    const closestPvt = pvtUnits[0];

    // Check for Smart Choice Phase
    if (closestGov && closestPvt) {
        let govDist = getDistance(pLat, pLng, closestGov.lat, closestGov.lng);
        let pvtDist = getDistance(pLat, pLng, closestPvt.lat, closestPvt.lng);
        let govETA = Math.round(govDist / METERS_PER_MINUTE);
        let pvtETA = Math.round(pvtDist / METERS_PER_MINUTE);

        // Trigger Choice if Gov is > 15m away and Pvt is at least 2x closer
        if (govETA > GOVT_TIME_THRESHOLD && pvtDist < (govDist / 2)) {
            io.to(pId).emit('SMART_CHOICE_PROMPT', {
                govTime: govETA,
                govDist: (govDist/1000).toFixed(1),
                pvtTime: pvtETA,
                pvtDist: (pvtDist/1000).toFixed(1)
            });
            return; 
        }
    }

    // Default: Start Government-First Waterfall
    executeWaterfall(pId, [...govUnits, ...pvtUnits], pLat, pLng);
}

async function executeWaterfall(pId, queue, pLat, pLng) {
    for (let driver of queue) {
        io.to(pId).emit('COMFORT_MSG', `Contacting nearest ${driver.type} ambulance...`);
        
        const accepted = await new Promise(resolve => {
            const timeout = setTimeout(() => resolve(false), 15000); // 15s to accept
            io.to(driver.id).emit('DISPATCH_INVITE', { pLat, pLng }, (response) => {
                clearTimeout(timeout);
                if (response && response.accepted) resolve(true);
                else resolve(false);
            });
        });

        if (accepted) {
            activeDrivers[driver.id].status = 'busy';
            activeDrivers[driver.id].assignedPatient = pId;
            io.to(pId).emit('MISSION_STARTED', { 
                msg: `Help is on the way! ${driver.type.toUpperCase()} unit assigned.`,
                driverName: driver.name 
            });
            return;
        }
    }
    io.to(pId).emit('COMFORT_MSG', "All units busy. Retrying wider network scan...");
}

// --- SOCKET CONNECTION HUB ---
io.on('connection', (socket) => {
    console.log('Node Connected:', socket.id);

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
        // Update Driver Location
        if (activeDrivers[socket.id]) {
            activeDrivers[socket.id].lat = data.lat;
            activeDrivers[socket.id].lng = data.lng;
            // Immediate Corridor Activation if on mission
            if (activeDrivers[socket.id].status === 'busy') {
                runVirtualCorridor(socket.id);
                // Also update the patient on live distance
                const pId = activeDrivers[socket.id].assignedPatient;
                if (pId && activePatients[pId]) {
                    const d = getDistance(data.lat, data.lng, activePatients[pId].lat, activePatients[pId].lng);
                    io.to(pId).emit('LIVE_DISTANCE', d);
                }
            }
        } 
        // Update Commuter/Patient Location
        else if (activeCommuters[socket.id]) {
            activeCommuters[socket.id].lat = data.lat;
            activeCommuters[socket.id].lng = data.lng;
        }
    });

    socket.on('EMERGENCY_TRIGGER', (coords) => {
        activePatients[socket.id] = { lat: coords.lat, lng: coords.lng };
        processEmergencyRequest(socket.id, coords.lat, coords.lng);
    });

    socket.on('RESOLVE_CHOICE', (choice) => {
        const p = activePatients[socket.id];
        if (!p) return;
        // Re-calculate list based on choice
        let drivers = Object.keys(activeDrivers).map(id => ({ id, ...activeDrivers[id] })).filter(d => d.status === 'available');
        let queue = (choice === 'private') 
            ? drivers.filter(d => d.type === 'private').sort((a,b) => getDistance(p.lat, p.lng, a.lat, a.lng) - getDistance(p.lat, p.lng, b.lat, b.lng))
            : drivers.sort((a,b) => (a.type === 'government' ? -1 : 1));
        
        executeWaterfall(socket.id, queue, p.lat, p.lng);
    });

    socket.on('disconnect', () => {
        delete activeDrivers[socket.id];
        delete activeCommuters[socket.id];
        delete activePatients[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`RescuePath Backend Live on Port ${PORT}`));
