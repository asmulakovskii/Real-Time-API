# CA4 - OOP

# Real-Time Stock Trading Dashboard
This project simulates real-time stock trading data, aggregates it, and displays the data in a real-time updating web dashboard.

## How to Run the Project
Follow these simple steps to run the simulator, server, and view the dashboard:

### 1. Start the Simulator
Open a terminal inside the project folder and run:

```bash
python simulator.py
```

### 2. Start the Aggregation Server
Open a second terminal (new terminal window) in the same project folder and run:

```bash
python server.py
```
This will start the server that consumes trade data from the simulator and prepares it for the web client.

### 3. Open the Web Dashboard
Open a third terminal an run:

```bash
python simple-server.py
```

This will open our website.
You will see the control buttons: Start, Stop, Reset, and Speed control.

### 4. Start the Simulation
Click the Start button on the webpage.

The status will change to Connected (green).

Price Chart, Volume Chart, and MACD Chart will update in real-time.

## Implementation Details

### Simulator

The simulator component:
- Reads the AAPL.csv file into memory
- Groups trades by second
- Provides both WebSocket and HTTP interfaces
- Broadcasts trades with their original timestamps
- Supports configurable replay speed

### Server

The server component:
- Connects to the simulator via WebSocket
- Processes raw trade data
- Aggregates data by minute
- Calculates technical indicators
- Broadcasts processed data to connected browsers
- Handles reconnection with exponential backoff

### Client

The client component:
- Connects to the server via WebSocket
- Displays real-time candlestick charts
- Shows volume analysis
- Displays MACD indicator
- Updates summary statistics in real-time
- Handles connection status and reconnection logic

### Project Features
Real-time Price Chart (with 10-period and 20-period Moving Averages)
Real-time Traded Volume Chart
MACD Indicator Chart
Dashboard showing Last Price, Open, High, Low, Volume, Trade Count
Start / Stop / Reset Simulation
Speed Control (0,5x, 1x, 2x, 5x)

### Technologies Used
FastAPI (Simulator API)
WebSocket for real-time updates
Pandas for data aggregation
ApexCharts.js for Candlestick and Moving Averages
Chart.js for Volume and MACD Charts
JavaScript, HTML, CSS for Frontend