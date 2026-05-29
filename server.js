const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); 

const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// --- CONFIGURATION: TARGET SET TO LUXETTIPET ---
const TARGET_LAT = 18.8753; 
const TARGET_LNG = 79.2138; 

// --- THE MATH: Haversine Formula ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radius of Earth in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
              
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c); 
}

// --- CONNECTION LOGIC ---
io.on('connection', (socket) => {
    console.log('New link established with device: ' + socket.id);

    socket.on('start_journey', (data) => {
        if (data.lat && data.lng) {
            const distance = calculateDistance(data.lat, data.lng, TARGET_LAT, TARGET_LNG);
            
            // Log this so you can see it in your Render Dashboard 'Logs' tab
            console.log(`Device at [${data.lat}, ${data.lng}] is ${distance}m from Luxettipet`);

            // Send the distance back to the frontend display
            socket.emit('proximity_update', distance);
        }
    });

    socket.on('disconnect', () => {
        console.log('Device disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Backend is live on port ${PORT}. Target: Luxettipet`);
});
