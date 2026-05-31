from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import math
import time

app = FastAPI()

# --- DATA MODELS ---
class SOSRequest(BaseModel):
    patient_id: str
    lat: float
    lon: float
    medical_id: Optional[dict] = None

class Telemetry(BaseModel):
    ambulance_id: str
    lat: float
    lon: float
    destination: str
    code_status: str

# --- HOSPITAL DATABASES ---
mancherial_hospitals = [
    {"name": "Government General Hospital", "type": "Government", "location": "Mancherial", "priority": 1, "lat": 18.872, "lon": 79.212},
    {"name": "Sri Venkateshwara Multi Speciality", "type": "Private", "location": "Mancherial", "priority": 2, "lat": 18.876, "lon": 79.218},
    {"name": "RHS Maxcare Multi Speciality", "type": "Private", "location": "Mancherial", "priority": 3, "lat": 18.879, "lon": 79.222},
    {"name": "Pulse Critical Care Hospital", "type": "Private", "location": "Mancherial", "priority": 4, "lat": 18.882, "lon": 79.228}
]

karimnagar_hospitals = [
    {"name": "Government Civil Hospital", "type": "Government", "location": "Karimnagar", "priority": 1, "lat": 18.438, "lon": 79.132},
    {"name": "Apollo Reach Hospital", "type": "Private", "location": "Karimnagar", "priority": 2, "lat": 18.442, "lon": 79.136}
]

hyderabad_hospitals = [
    {"name": "Osmania General Hospital", "type": "Government", "location": "Hyderabad", "priority": 1, "lat": 17.378, "lon": 78.481},
    {"name": "Apollo Health City", "type": "Private", "location": "Hyderabad", "priority": 3, "lat": 17.415, "lon": 78.411}
]

# --- MOCK DATABASES ---
ambulances = [
    {"id": "AMB-108-GOV", "type": "Govt", "lat": 18.870, "lon": 79.210, "status": "Available"},
    {"id": "AMB-PVT-01", "type": "Private", "lat": 18.880, "lon": 79.220, "status": "Available", "rate": 1500}
]

# Database of physical cell tower locations in the city
cell_towers = [
    {"tower_id": "TOWER_UTHKOOR_01", "lat": 18.875, "lon": 79.215},
    {"tower_id": "TOWER_MAIN_RD_02", "lat": 18.885, "lon": 79.225},
    {"tower_id": "TOWER_LUXETTIPET_01", "lat": 18.865, "lon": 79.205},
    {"tower_id": "TOWER_HIGHWAY_03", "lat": 18.895, "lon": 79.235}
]

# --- CORE MATH: HAVERSINE FORMULA ---
def get_distance(lat1, lon1, lat2, lon2):
    R = 6371  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * \
        math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

# --- V2X LOGIC: CELL TOWER PATH CORRIDOR ---
def trigger_cell_broadcast(tower_id: str, message: str):
    """
    Simulates sending an urgent Cell Broadcast (CB) instruction to a specific tower.
    In production, this interfaces with the Telecom Service Provider (TSP) API via eNodeB/gNodeB protocols.
    """
    # This forces a top-priority native pop-up on all phones within that tower's cell radius
    print(print(f"📡 [CELL BROADCAST SUCCESS] → Sent to {tower_id} | Msg: {message}"))

def process_tower_clearance(amb_lat: float, amb_lon: float, dest_name: str):
    """
    Analyzes towers within a 3km radius of the ambulance and triggers broadcasts
    if the tower is positioned forward along the rescue route.
    """
    # 1. Resolve destination coordinates from databases
    dest_lat, dest_lon = None, None
    all_hospitals = mancherial_hospitals + karimnagar_hospitals + hyderabad_hospitals
    for h in all_hospitals:
        if h["name"].lower() == dest_name.lower():
            dest_lat, dest_lon = h["lat"], h["lon"]
            break
            
    if not dest_lat:
        return  # Destination not found in regional DB, skip path parsing
        
    current_dist_to_dest = get_distance(amb_lat, amb_lon, dest_lat, dest_lon)
    
    # 2. Check which towers are nearby and in front of the ambulance vector
    for tower in cell_towers:
        dist_to_tower = get_distance(amb_lat, amb_lon, tower["lat"], tower["lon"])
        
        # Target towers within 3.0 km radius
        if dist_to_tower <= 3.0:
            tower_to_dest = get_distance(tower["lat"], tower["lon"], dest_lat, dest_lon)
            
            # The Critical Condition: The tower must be closer to the hospital than the ambulance currently is
            if tower_to_dest < current_dist_to_dest:
                alert_msg_en = f"EMERGENCY: Ambulance approaching on this route. Move your vehicle to the LEFT lane and clear the path immediately."
                alert_msg_te = f"అత్యవసర పరిస్థితి: అంబులెన్స్ ఈ మార్గంలో వస్తోంది. దయచేసి మీ వాహనాన్ని ఎడమ వైపునకు జరిపి వెంటనే దారి ఇవ్వండి."
                
                # Fire the cell broadcast network signal
                trigger_cell_broadcast(tower["tower_id"], f"{alert_msg_en} / {alert_msg_te}")

# --- API ENDPOINTS ---
@app.post("/sos")
async def process_sos(request: SOSRequest):
    """
    Handles incoming SOS, finds nearest tower, and prioritizes Government rescue units.
    """
    closest_tower = None
    min_tower_dist = float('inf')
    for tower in cell_towers:
        dist = get_distance(request.lat, request.lon, tower["lat"], tower["lon"])
        if dist < min_tower_dist:
            min_tower_dist = dist
            closest_tower = tower

    govt_units = [a for a in ambulances if a['type'] == 'Govt' and a['status'] == 'Available']
    pvt_units = [a for a in ambulances if a['type'] == 'Private' and a['status'] == 'Available']
    
    selected_unit = None
    if govt_units:
        selected_unit = govt_units[0]
    elif pvt_units:
        selected_unit = pvt_units[0]
    
    return {
        "status": "EMERGENCY_ACTIVE",
        "nearest_tower": closest_tower["tower_id"] if closest_tower else "Searching...",
        "dispatch_unit": selected_unit["id"] if selected_unit else "NO_UNITS_AVAILABLE",
        "hospitals": {
            "primary_mancherial": mancherial_hospitals,
            "secondary_karimnagar": karimnagar_hospitals,
            "tertiary_hyderabad": hyderabad_hospitals
        },
        "timestamp": time.time()
    }

@app.post("/telemetry/update")
async def receive_telemetry(data: Telemetry, background_tasks: BackgroundTasks):
    """
    Endpoint for high-frequency live location updates from the driver's phone.
    Triggers targeted regional cell tower clear-out blocks dynamically.
    """
    if data.code_status == "AMBULANCE_CODE_1" and data.destination:
        # Offload the geographical network scanning to a background task 
        # to ensure the API response remains under 5 milliseconds.
        background_tasks.add_task(
            process_tower_clearance, 
            data.lat, 
            data.lon, 
            data.destination
        )
        return {"status": "CLEARANCE_ACTIVE", "processed_at": time.time()}
        
    return {"status": "LOGGED", "processed_at": time.time()}
