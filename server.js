const express = require('express');
const path =require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// 1. Tell the server to use your public folder files
app.use(express.static(path.join(__dirname, 'public')));

// 2. Tell the server to load your map (index.html) automatically
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3. Global System State for the Ambulance
let activeAmbulance = {
  isActive: false,
  id: "HYD-AMB-108",
  lat: null,
  lng: null,
  destination: "Care Hospital, Banjara Hills"
};

// 4. GPS Distance Calculator (Haversine Formula)
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radius of the Earth in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 5. Live Tracking Connection
io.on('connection', (socket) => {
  console.log('A user connected');

  // Send current status to anyone who opens the map
  socket.emit('ambulanceStatus', activeAmbulance);

  // Update location when ambulance moves
  socket.on('updateLocation', (data) => {
    activeAmbulance.lat = data.lat;
    activeAmbulance.lng = data.lng;
    io.emit('locationUpdated', activeAmbulance);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// 6. Start the server on Render's required port
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`RescuePath Server running on port ${PORT}`);
});
