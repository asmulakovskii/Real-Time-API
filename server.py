# server.py
# This component connects to the simulator, processes trade data,
# and serves connected browsers with aggregated data

import asyncio
import pandas as pd
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
import json
import logging
from datetime import datetime
import uvicorn
from typing import List, Dict, Optional
import aiohttp
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("server")

app = FastAPI(title="Trading Data Server")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active browser connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New browser connection established. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Browser connection closed. Remaining connections: {len(self.active_connections)}")

    async def broadcast(self, message: Dict):
        if not self.active_connections:
            return
            
        try:
            # Convert message to JSON
            message_json = json.dumps(message)
            
            disconnect_list = []
            
            for connection in self.active_connections:
                try:
                    await connection.send_text(message_json)
                except Exception as e:
                    logger.error(f"Error sending message to browser: {e}")
                    disconnect_list.append(connection)
                    
            # Clean up disconnected clients
            for connection in disconnect_list:
                if connection in self.active_connections:
                    self.active_connections.remove(connection)
        except Exception as e:
            logger.error(f"Error broadcasting message: {e}")

browser_manager = ConnectionManager()

# Store and process trades
class TradeProcessor:
    def __init__(self):
        self.all_trades = []
        self.minute_aggregates = {}
        self.last_price = None
        self.opening_price = None
        self.day_high = None
        self.day_low = None
        self.total_volume = 0
        self.trade_count = 0
        self.last_update_time = None
        
    async def add_trades(self, trades_list):
        """Process incoming trades and update aggregations"""
        if not trades_list:
            return False
            
        # Add trades to master list
        self.all_trades.extend(trades_list)
        self.trade_count += len(trades_list)
        
        # Create DataFrame for easier processing
        df = pd.DataFrame(trades_list)
        
        # Convert datetime strings to datetime objects
        try:
            # Custom datetime parsing for the specific format in AAPL.csv
            def parse_datetime(dt_str):
                if not isinstance(dt_str, str):
                    return dt_str
                    
                parts = dt_str.split(':')
                if len(parts) == 4:  # If it has the form HH:MM:SS:mmm
                    date_part = parts[0]  # Contains date and hour
                    minute = parts[1]
                    second = parts[2]
                    ms = parts[3]
                    # Reconstruct as YYYY-MM-DD HH:MM:SS.mmm
                    return f"{date_part}:{minute}:{second}.{ms}"
                return dt_str
                
            if 'original_datetime' in df.columns:
                df['parsed_datetime'] = df['original_datetime'].apply(parse_datetime)
                df['datetime'] = pd.to_datetime(df['parsed_datetime'])
            elif 'datetime' in df.columns and isinstance(df['datetime'].iloc[0], str):
                df['parsed_datetime'] = df['datetime'].apply(parse_datetime)
                df['datetime'] = pd.to_datetime(df['parsed_datetime'])
        except Exception as e:
            logger.error(f"Error processing datetime: {e}")
            
        # Get minute timestamp (floor to minute)
        df['minute'] = df['datetime'].dt.floor('min')
        
        # Update the last price
        self.last_price = df['price'].iloc[-1]
        
        # Update opening, high, low prices
        if self.opening_price is None:
            self.opening_price = df['price'].iloc[0]
            
        if self.day_high is None or df['price'].max() > self.day_high:
            self.day_high = df['price'].max()
            
        if self.day_low is None or df['price'].min() < self.day_low:
            self.day_low = df['price'].min()
            
        # Update total volume
        self.total_volume += df['quantity'].sum()
        
        # Aggregate by minute - THIS LINE NEEDS THE AWAIT
        await self._aggregate_by_minute(df)
        
        self.last_update_time = datetime.now()
        return True
        
    async def _aggregate_by_minute(self, df):
        """Aggregate trades by minute"""
        # Group by minute
        minute_groups = df.groupby('minute')
        
        # Calculate aggregates for each minute
        for minute, group in minute_groups:
            minute_str = minute.isoformat()
            
            # If minute already exists, update with new data
            if minute_str in self.minute_aggregates:
                existing = self.minute_aggregates[minute_str]
                
                # Update min and max prices
                min_price = min(existing['min_price'], group['price'].min())
                max_price = max(existing['max_price'], group['price'].max())
                
                # Keep the first price as open, and set the latest as close
                open_price = existing['open_price']
                close_price = group['price'].iloc[-1]
                
                # Add volumes
                volume = existing['volume'] + group['quantity'].sum()
                
                # Combine trade counts
                trade_count = existing['trade_count'] + len(group)
                
            else:
                # Create new minute aggregate
                min_price = group['price'].min()
                max_price = group['price'].max()
                open_price = group['price'].iloc[0]
                close_price = group['price'].iloc[-1]
                volume = group['quantity'].sum()
                trade_count = len(group)
            
            self.minute_aggregates[minute_str] = {
                'minute': minute_str,
                'min_price': float(min_price),
                'max_price': float(max_price),
                'open_price': float(open_price),
                'close_price': float(close_price),
                'volume': int(volume),
                'trade_count': int(trade_count),
                'vwap': float((group['price'] * group['quantity']).sum() / group['quantity'].sum()) if not group.empty else None
            }
    
    def get_minute_aggregates(self):
        """Get all minute aggregates as a list sorted by time"""
        result = list(self.minute_aggregates.values())
        return sorted(result, key=lambda x: x['minute'])
    
    def get_summary(self):
        """Get trading summary statistics"""
        return {
            'last_price': float(self.last_price) if self.last_price is not None else None,
            'opening_price': float(self.opening_price) if self.opening_price is not None else None,
            'day_high': float(self.day_high) if self.day_high is not None else None,
            'day_low': float(self.day_low) if self.day_low is not None else None,
            'total_volume': int(self.total_volume) if self.total_volume is not None else 0,
            'trade_count': int(self.trade_count) if self.trade_count is not None else 0,
            'last_update': self.last_update_time.isoformat() if self.last_update_time else None
        }
    
    def calculate_moving_averages(self, window_sizes=[10, 20]):
        """Calculate moving averages for candlestick data"""
        if len(self.minute_aggregates) < 2:
            return {}
            
        # Convert to DataFrame for easier calculation
        minute_data = self.get_minute_aggregates()
        df = pd.DataFrame(minute_data)
        
        # Calculate moving averages for specified window sizes
        result = {}
        for window in window_sizes:
            if len(df) >= window:
                ma_values = df['close_price'].rolling(window=window).mean()
                # Convert to native Python types
                result[f'MA{window}'] = {str(i): float(val) for i, val in enumerate(ma_values.dropna())}
                
        return result
    
    def calculate_macd(self, fast_period=12, slow_period=26, signal_period=9):
        """Calculate MACD indicator"""
        if len(self.minute_aggregates) < max(fast_period, slow_period, signal_period):
            return {}
            
        minute_data = self.get_minute_aggregates()
        df = pd.DataFrame(minute_data)
        
        # Calculate exponential moving averages
        fast_ema = df['close_price'].ewm(span=fast_period, adjust=False).mean()
        slow_ema = df['close_price'].ewm(span=slow_period, adjust=False).mean()
        
        # Calculate MACD line
        macd_line = fast_ema - slow_ema
        
        # Calculate signal line
        signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()
        
        # Calculate histogram
        histogram = macd_line - signal_line
        
        # Convert to native Python types
        return {
            'macd_line': {str(i): float(val) for i, val in enumerate(macd_line)},
            'signal_line': {str(i): float(val) for i, val in enumerate(signal_line)},
            'histogram': {str(i): float(val) for i, val in enumerate(histogram)}
        }
    
    def clear_data(self):
        """Clear all stored data"""
        self.all_trades = []
        self.minute_aggregates = {}
        self.last_price = None
        self.opening_price = None
        self.day_high = None
        self.day_low = None
        self.total_volume = 0
        self.trade_count = 0
        self.last_update_time = None

# Create trade processor instance
trade_processor = TradeProcessor()

# Configuration for simulator connection
simulator_config = {
    "host": "localhost",
    "port": 8000,
    "reconnect_delay": 5,  # seconds
    "max_reconnect_attempts": 10,
    "ws_url": "ws://localhost:8000/ws",
    "http_url": "http://localhost:8000/trades"
}

# Connect to simulator and process trades
async def connect_to_simulator():
    """Connect to trade simulator via WebSocket and process incoming trades"""
    reconnect_attempts = 0
    
    while True:
        try:
            async with aiohttp.ClientSession() as session:
                ws_url = simulator_config["ws_url"]
                logger.info(f"Connecting to simulator at {ws_url}")
                
                # Try to get initial historical data via HTTP
                try:
                    http_url = simulator_config["http_url"]
                    async with session.get(http_url) as resp:
                        if resp.status == 200:
                            hist_trades = await resp.json()
                            logger.info(f"Loaded {len(hist_trades)} historical trades")
                            await trade_processor.add_trades(hist_trades)  # Use await here
                            # Broadcast initial data to any connected browsers
                            await broadcast_updates()
                except Exception as e:
                    logger.warning(f"Could not get historical trades: {e}")
                
                # Connect to WebSocket for real-time updates
                async with session.ws_connect(ws_url) as ws:
                    logger.info("Connected to simulator WebSocket")
                    reconnect_attempts = 0  # Reset reconnect counter on successful connection
                    
                    # Process WebSocket messages
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            try:
                                data = json.loads(msg.data)
                                
                                # Process trades if present
                                if "trades" in data:
                                    trades = data["trades"]
                                    if await trade_processor.add_trades(trades):  # Use await here
                                        # Broadcast updates to browsers
                                        await broadcast_updates()
                            except Exception as e:
                                logger.error(f"Error processing message: {e}")
                                
                        elif msg.type == aiohttp.WSMsgType.CLOSED:
                            logger.warning("WebSocket connection closed by simulator")
                            break
                        elif msg.type == aiohttp.WSMsgType.ERROR:
                            logger.error(f"WebSocket error: {msg}")
                            break
                            
        except Exception as e:
            logger.error(f"Error connecting to simulator: {e}")
            
            # Handle reconnection with backoff
            reconnect_attempts += 1
            if reconnect_attempts <= simulator_config["max_reconnect_attempts"]:
                wait_time = simulator_config["reconnect_delay"] * min(reconnect_attempts, 5)
                logger.info(f"Reconnecting in {wait_time} seconds (attempt {reconnect_attempts})")
                await asyncio.sleep(wait_time)
            else:
                logger.error(f"Maximum reconnection attempts ({simulator_config['max_reconnect_attempts']}) reached. Giving up.")
                await asyncio.sleep(60)  # Wait longer before trying again
                reconnect_attempts = 0

# Converter for numpy types for JSON serialization
def convert_numpy_types(obj):
    """Convert NumPy types to Python native types for JSON serialization"""
    import numpy as np
    
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, (pd.Timestamp, pd.Timedelta)):
        return str(obj)
    elif isinstance(obj, dict):
        return {k: convert_numpy_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(i) for i in obj]
    else:
        return obj

# Broadcast updates to all connected browsers
async def broadcast_updates():
    """Send updated data to all connected browsers"""
    # Prepare data to send
    update_data = {
        'timestamp': datetime.now().isoformat(),
        'minute_aggregates': trade_processor.get_minute_aggregates(),
        'summary': trade_processor.get_summary(),
        'moving_averages': trade_processor.calculate_moving_averages(),
        'macd': trade_processor.calculate_macd()
    }
    
    # Convert NumPy types before serialization
    update_data = convert_numpy_types(update_data)
    
    # Broadcast to all browsers
    await browser_manager.broadcast(update_data)

# WebSocket endpoint for browsers
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await browser_manager.connect(websocket)
    
    try:
        # Send initial data to the client
        update_data = {
            'timestamp': datetime.now().isoformat(),
            'minute_aggregates': trade_processor.get_minute_aggregates(),
            'summary': trade_processor.get_summary(),
            'moving_averages': trade_processor.calculate_moving_averages(),
            'macd': trade_processor.calculate_macd()
        }
        await websocket.send_text(json.dumps(update_data))
        
        # Keep connection alive until disconnected
        while True:
            # Wait for client messages (ping/pong or other)
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except:
                pass
                
    except WebSocketDisconnect:
        browser_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        browser_manager.disconnect(websocket)

# HTTP endpoint to get current state (for initial load or reconnection)
@app.get("/data")
async def get_current_data():
    """Get current aggregated trading data"""
    data = {
        'minute_aggregates': trade_processor.get_minute_aggregates(),
        'summary': trade_processor.get_summary(),
        'moving_averages': trade_processor.calculate_moving_averages(),
        'macd': trade_processor.calculate_macd()
    }
    
    # Convert NumPy types to Python native types
    return convert_numpy_types(data)

# Endpoint to reset all data
@app.post("/reset")
async def reset_data():
    """Reset all stored trade data"""
    trade_processor.clear_data()
    return {"status": "success", "message": "All data has been reset"}

@app.on_event("startup")
async def startup_event():
    # Start connecting to simulator in background
    asyncio.create_task(connect_to_simulator())

# Create a background task to periodically broadcast updates
async def periodic_update_task():
    """Send regular updates to browsers even if no new trades arrive"""
    while True:
        await broadcast_updates()
        await asyncio.sleep(1)  # Update every second

@app.on_event("startup")
async def start_periodic_updates():
    asyncio.create_task(periodic_update_task())

# Run the server
if __name__ == "__main__":
    uvicorn.run(
        "server:app", 
        host="0.0.0.0", 
        port=8001, 
        log_level="info",
        reload=False
    )
