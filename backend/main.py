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
    {"name": "Government General Hospital", "type": "Government", "location": "Mancherial", "priority": 1},
    {"name": "Sri Venkateshwara Multi Speciality", "type": "Private", "location": "Mancherial", "priority": 2},
    {"name": "RHS Maxcare Multi Speciality", "type": "Private", "location": "Mancherial", "priority": 3},
    {"name": "Pulse Critical Care Hospital", "type": "Private", "location": "Mancherial", "priority": 4}
]

karimnagar_hospitals = [
    {"name": "Government Civil Hospital", "type": "Government", "location": "Karimnagar", "priority": 1},
    {"name": "Apollo Reach Hospital", "type": "Private", "location": "Karimnagar", "priority": 2},
    {"name": "Medicover Hospitals", "type": "Private", "location": "Karimnagar", "priority": 3},
    {"name": "Prathima Institute of Medical Sciences", "type": "Private", "location": "Karimnagar", "priority": 4}
]

hyderabad_hospitals = [
    {"name": "Osmania General Hospital", "type": "Government", "location": "Hyderabad", "priority": 1},
    {"name": "Gandhi Hospital", "type": "Government", "location": "Hyderabad", "priority": 1},
    {"name": "NIMS (Nizam's Institute)", "type": "Government/Semi", "location": "Hyderabad", "priority": 1},
    {"name": "Yashoda Hospitals", "type": "Private", "location": "Hyderabad", "priority": 2},
    {"name": "Apollo Health City", "type": "Private", "location": "Hyderabad", "priority": 3}
]
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
# --- STEP 1: THE WATERFALL DISPATCH ---
@app.post("/sos")
async def process_sos(request: SOSRequest):
    """
    Handles incoming SOS, finds nearest tower, 
    and prioritizes Government rescue units.
    """
    
    # 1. FIND NEAREST CELL TOWER (For signal tracking)
    closest_tower = None
    min_tower_dist = float('inf')
    for tower in cell_towers:
        dist = get_distance(request.lat, request.lon, tower["lat"], tower["lon"])
        if dist < min_tower_dist:
            min_tower_dist = dist
            closest_tower = tower

    # 2. DISPATCH LOGIC (Government First)
    # Filter for available units
    govt_units = [a for a in ambulances if a['type'] == 'Govt' and a['status'] == 'Available']
    pvt_units = [a for a in ambulances if a['type'] == 'Private' and a['status'] == 'Available']
    
    selected_unit = None
    if govt_units:
        selected_unit = govt_units[0] # Priority 1: Govt
    elif pvt_units:
        selected_unit = pvt_units[0] # Priority 2: Private
    
    # 3. RESPONSE
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
