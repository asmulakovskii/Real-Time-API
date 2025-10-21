# simulator.py
# This component reads the AAPL.csv file and replays the trades in real-time
# It provides WebSocket and HTTP interfaces for the server to consume

import asyncio
import pandas as pd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
import json
import logging
from datetime import datetime
import uvicorn
from typing import List, Dict, Optional
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("simulator")

app = FastAPI(title="Trade Simulator")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New connection established. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(f"Connection closed. Remaining connections: {len(self.active_connections)}")

    async def broadcast(self, message: Dict):
        if not self.active_connections:
            return
            
        message_json = json.dumps(message)
        disconnect_list = []
        
        for connection in self.active_connections:
            try:
                await connection.send_text(message_json)
            except Exception as e:
                logger.error(f"Error sending message: {e}")
                disconnect_list.append(connection)
                
        # Clean up disconnected clients
        for connection in disconnect_list:
            self.active_connections.remove(connection)

manager = ConnectionManager()

# Store the current simulation state
class SimulationState:
    def __init__(self):
        self.trade_data = None
        self.last_second_index = 0
        self.is_running = False
        self.speed_factor = 1.0
        self.trade_buffer = {}  # Store trades by second
        self.all_seconds = []
        
    def load_data(self, file_path='AAPL.csv'):
        try:
            logger.info(f"Loading trade data from {file_path}")
            df = pd.read_csv(file_path)
            
            # Process datetime to proper format (handling the unique format in AAPL.csv)
            df['original_datetime'] = df['datetime']
            
            # Custom datetime parsing for the specific format in AAPL.csv
            # Format is like "2020-07-01 04:00:00:072" with unusual structure
            def parse_datetime(dt_str):
                parts = dt_str.split(':')
                if len(parts) == 4:  # If it has the form HH:MM:SS:mmm
                    date_part = parts[0]  # Contains date and hour
                    minute = parts[1]
                    second = parts[2]
                    ms = parts[3]
                    # Reconstruct as YYYY-MM-DD HH:MM:SS.mmm
                    return f"{date_part}:{minute}:{second}.{ms}"
                return dt_str
                
            df['parsed_datetime'] = df['datetime'].apply(parse_datetime)
            df['datetime'] = pd.to_datetime(df['parsed_datetime'])
            df['second'] = df['datetime'].dt.floor('S')
            
            # Sort by datetime
            df = df.sort_values('datetime')
            
            # Group by second
            second_groups = df.groupby('second')
            
            # Store trades by second
            self.trade_buffer = {}
            for second, group in second_groups:
                self.trade_buffer[second] = group[['original_datetime', 'price', 'quantity', 'venue']].to_dict('records')
            
            # Get all unique seconds
            self.all_seconds = sorted(list(self.trade_buffer.keys()))
            
            logger.info(f"Loaded {len(df)} trades across {len(self.all_seconds)} seconds")
            self.trade_data = df
            self.last_second_index = 0
            return True
        except Exception as e:
            logger.error(f"Error loading trade data: {e}")
            return False
            
    def get_trades_for_second(self, index):
        """Get all trades for a specific second index"""
        if index >= len(self.all_seconds):
            return None
            
        second = self.all_seconds[index]
        return {
            "timestamp": second.isoformat(),
            "trades": self.trade_buffer[second]
        }
    
    def get_historical_trades(self, limit):
        """Get historical trades up to the current simulation point"""
        if not self.trade_data is not None:
            return []
            
        all_trades = []
        for i in range(min(self.last_second_index, len(self.all_seconds))):
            second = self.all_seconds[i]
            all_trades.extend(self.trade_buffer[second])
            
        # Return most recent trades up to limit
        return all_trades[-limit:] if limit < len(all_trades) else all_trades

simulation = SimulationState()

@app.on_event("startup")
async def startup_event():
    if not simulation.load_data():
        logger.error("Failed to load trade data, simulator cannot start")

# HTTP endpoint to get historical trades
@app.get("/trades")
async def get_trades(limit: int = 100):
    """
    Get historical trades up to the current simulation point.
    
    Args:
        limit: Maximum number of trades to return (default 100)
    """
    return simulation.get_historical_trades(limit)

# WebSocket endpoint for real-time trade updates
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    # Send confirmation message
    await websocket.send_text(json.dumps({
        "type": "connection_established",
        "message": "Connected to trade simulator"
    }))
    
    try:
        # Keep connection alive until disconnected
        while True:
            # Wait for any client messages
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

# Start/stop/configure the simulation
@app.post("/simulation/control")
async def control_simulation(request: Request):
    data = await request.json()
    action = data.get("action")
    
    if action == "start":
        if not simulation.is_running:
            simulation.is_running = True
            asyncio.create_task(simulate_real_time_data())
            return {"status": "started"}
        return {"status": "already_running"}
        
    elif action == "stop":
        simulation.is_running = False
        return {"status": "stopped"}
        
    elif action == "reset":
        simulation.is_running = False
        simulation.last_second_index = 0
        return {"status": "reset"}
        
    elif action == "speed":
        try:
            speed = float(data.get("speed", 1.0))
            if 0.1 <= speed <= 10.0:
                simulation.speed_factor = speed
                return {"status": "speed_updated", "speed_factor": speed}
            return {"status": "error", "message": "Speed must be between 0.1 and 10.0"}
        except:
            return {"status": "error", "message": "Invalid speed value"}
    
    return {"status": "error", "message": "Unknown action"}

# Simulate real-time data
async def simulate_real_time_data():
    logger.info("Starting trade simulation")
    
    while simulation.is_running:
        current_index = simulation.last_second_index
        
        if current_index >= len(simulation.all_seconds):
            logger.info("End of trade data reached, resetting simulation")
            simulation.last_second_index = 0
            continue
        
        # Get trades for current second
        current_trades = simulation.get_trades_for_second(current_index)
        
        if current_trades:
            # Broadcast to all connected clients
            await manager.broadcast(current_trades)
            
        # Increment to next second
        simulation.last_second_index += 1
        
        # Sleep to simulate real-time (adjusted by speed factor)
        sleep_time = 1.0 / simulation.speed_factor
        await asyncio.sleep(sleep_time)
    
    logger.info("Trade simulation stopped")

# Get current simulation status
@app.get("/simulation/status")
async def get_simulation_status():
    if simulation.trade_data is None:
        return {"status": "not_initialized"}
        
    current_second = None
    if 0 <= simulation.last_second_index < len(simulation.all_seconds):
        current_second = simulation.all_seconds[simulation.last_second_index].isoformat()
        
    return {
        "status": "running" if simulation.is_running else "stopped",
        "total_seconds": len(simulation.all_seconds),
        "current_second_index": simulation.last_second_index,
        "current_second": current_second,
        "speed_factor": simulation.speed_factor
    }

# Run the simulator with auto-reload disabled for production use
if __name__ == "__main__":
    # Auto-start the simulation
    simulation.is_running = True
    
    # Run uvicorn server
    uvicorn.run(
        "simulator:app", 
        host="0.0.0.0", 
        port=8000, 
        log_level="info",
        reload=False
    )
