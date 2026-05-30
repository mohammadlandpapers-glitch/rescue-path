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

# --- MOCK DATABASES (Replace with PostgreSQL in production) ---
ambulances = [
    {"id": "AMB-108-GOV", "type": "Govt", "lat": 18.870, "lon": 79.210, "status": "Available"},
    {"id": "AMB-PVT-01", "type": "Private", "lat": 18.880, "lon": 79.220, "status": "Available", "rate": 1500}
]

# Database of physical cell tower locations in the city
cell_towers = [
    {"tower_id": "TOWER_UTHKOOR_01", "lat": 18.875, "lon": 79.215},
    {"tower_id": "TOWER_MAIN_RD_02", "lat": 18.885, "lon": 79.225}
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

# --- STEP 1: THE WATERFALL DISPATCH ---
@app.post("/sos")
async def process_sos(request: SOSRequest):
    # 1. Search Government Units First
    govt_units = [a for a in ambulances if a['type'] == 'Govt' and a['status'] == 'Available']
    govt_units.sort(key=lambda x: get_distance(request.lat, request.lon, x['lat'], x['lon']))

    if govt_units:
        target = govt_units[0]
        # In real life, trigger a Push Notification to Driver App here
        return {"status": "SUCCESS", "msg": f"Govt Ambulance {target['id']} dispatched.", "ambulance_id": target['id']}

    # 2. Fallback to Private Units
    private_units = [a for a in ambulances if a['type'] == 'Private' and a['status'] == 'Available']
    if private_units:
        target = private_units[0]
        return {"status": "PRIVATE_OFFER", "rate": target['rate'], "ambulance_id": target['id']}

    raise HTTPException(status_code=404, detail="No ambulances available in radius")

# --- STEP 2 & 3: TELEMETRY & CELL TOWER CLEARANCE ---
@app.post("/telemetry")
async def receive_telemetry(data: Telemetry, background_tasks: BackgroundTasks):
    """
    Receives live GPS from Driver App and determines which towers to trigger.
    """
    # Find towers within 1km of the ambulance's current position
    active_towers = []
    for tower in cell_towers:
        dist = get_distance(data.lat, data.lon, tower['lat'], tower['lon'])
        if dist <= 1.0: # 1km clearance radius
            active_towers.append(tower['tower_id'])
    
    if active_towers:
        # Step 3: Trigger the actual broadcast logic
        background_tasks.add_task(trigger_cell_broadcast, active_towers, data.destination)
        
    return {"status": "BEACON_RECEIVED", "active_towers": active_towers}

def trigger_cell_broadcast(towers: List[str], destination: str):
    """
    This function would connect to a Telecom API (like Airtel/Jio CBC).
    """
    for tower in towers:
        print(f"!!! BROADCAST SENT TO {tower}: Emergency Vehicle cleared for {destination} !!!")
        # Actual API call would go here
