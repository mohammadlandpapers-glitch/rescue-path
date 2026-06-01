from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import math
import time
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

def get_distance(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * \
        math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

cell_towers = [{"tower_id": "TOWER_LUXETTIPET_01", "lat": 18.865, "lon": 79.205}]

def trigger_cell_broadcast(tower_id: str, message: str):
    print(f"📡 [CELL BROADCAST SUCCESS] → Sent to {tower_id} | Msg: {message}")

def process_tower_clearance(amb_lat: float, amb_lon: float, dest_name: str):
    for tower in cell_towers:
        trigger_cell_broadcast(tower["tower_id"], f"AMBULANCE APPROACHING {dest_name.upper()}. CLEAR PATH.")

@app.post("/sos")
async def process_sos(request: SOSRequest):
    print(f"🚨 SOS Received! Patient: {request.patient_id} at {request.lat}, {request.lon}")
    return {"status": "EMERGENCY_ACTIVE", "message": "Dispatching nearest unit."}

@app.post("/telemetry/update")
async def receive_telemetry(data: Telemetry, background_tasks: BackgroundTasks):
    print(f"🛰️ Telemetry: {data.ambulance_id} heading to {data.destination}")
    if data.code_status == "AMBULANCE_CODE_1":
        background_tasks.add_task(process_tower_clearance, data.lat, data.lon, data.destination)
    return {"status": "CLEARANCE_ACTIVE"}
