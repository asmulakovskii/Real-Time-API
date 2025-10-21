// Configuration
const SERVER_URL = 'localhost:8001';
const WS_URL = `ws://${SERVER_URL}/ws`;
const HTTP_URL = `http://${SERVER_URL}/data`;

// DOM Elements
const connectionIndicator = document.getElementById('connection-indicator');
const connectionText = document.getElementById('connection-text');
const lastPriceElement = document.getElementById('last-price');
const openingPriceElement = document.getElementById('opening-price');
const dayHighElement = document.getElementById('day-high');
const dayLowElement = document.getElementById('day-low');
const totalVolumeElement = document.getElementById('total-volume');
const tradeCountElement = document.getElementById('trade-count');
const lastUpdateTimeElement = document.getElementById('last-update-time');

// Chart toggle buttons
const candlestickToggleBtn = document.getElementById('candlestick-toggle');
const lineToggleBtn = document.getElementById('line-toggle');
const maToggleBtn = document.getElementById('ma-toggle');

// Simulation control buttons
const startSimulationBtn = document.getElementById('start-simulation');
const stopSimulationBtn = document.getElementById('stop-simulation');
const speedControl = document.getElementById('speed-control');

// State
let socket = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let pingInterval = null;
let minuteData = [];
let showMovingAverages = true;
let chartType = 'line';
let lastData = null;
let processedDataPoints = new Set();
let rawTradeData = []; // To store raw trades for higher resolution

// Charts
let priceChart = null;
let volumeChart = null;
let macdChart = null;

// Initialize the application
function init() {
    console.log("Initializing application...");
    
    // Enable candlestick button - UPDATED
    candlestickToggleBtn.disabled = false;
    candlestickToggleBtn.classList.remove('disabled');
    candlestickToggleBtn.style.opacity = '1';
    candlestickToggleBtn.style.cursor = 'pointer';
    
    // Initialize charts with basic settings
    initCharts();
    
    // Set up event listeners
    setupEventListeners();
    
    // Connect to server
    connectToServer();
}

// Initialize charts with fixed trading hours
function initCharts() {
    console.log("Initializing charts...");
    
    // Create price chart with improved styling
    const priceChartCtx = document.getElementById('price-chart').getContext('2d');
    priceChart = new Chart(priceChartCtx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'AAPL Price',
                data: [],
                borderColor: 'rgba(54, 130, 190, 1)', // Pleasant blue
                backgroundColor: 'rgba(54, 130, 190, 0.1)',
                borderWidth: 2,
                pointRadius: 0, // No dots
                fill: false,
                tension: 0.1 // Slight smoothing
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0 // Disable animations
            },
            interaction: {
                intersect: false, // Enable hover-anywhere
                mode: 'index'     // Show all values at current x position
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'minute',
                        stepSize: 10,
                        displayFormats: {
                            minute: 'HH:mm',
                            hour: 'HH:mm'
                        },
                    },
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Price'
                    },
                    // Add more padding to y-axis to ensure all data is visible
                    grace: '5%' // Add 5% padding to min and max
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        filter: function(legendItem, chartData) {
                            const labels = chartData.datasets.map(dataset => dataset.label);
                            return labels.indexOf(legendItem.text) === legendItem.datasetIndex;
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: function(tooltipItems) {
                            if (tooltipItems.length > 0) {
                                const date = new Date(tooltipItems[0].parsed.x);
                                return date.toLocaleTimeString();
                            }
                            return '';
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(2); // Show 2 decimal places
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });

    // Create volume chart with improved styling
    const volumeChartCtx = document.getElementById('volume-chart').getContext('2d');
    volumeChart = new Chart(volumeChartCtx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Volume',
                data: [], // Matching blue for volume
                borderColor: 'rgba(53, 162, 235, 1)',
                pointRadius: 0,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0 // Disable animations
            },
            interaction: {
                intersect: false,
                mode: 'index'
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour',
                        displayFormats: {
                            hour: 'HH:mm',
                            minute: 'HH:mm:ss'
                        },
                        stepSize: 1
                    },
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Volume'
                    },
                    grace: '5%'
                }
            },
            plugins: {
                legend: {
                    display: true
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: function(tooltipItems) {
                            if (tooltipItems.length > 0) {
                                const date = new Date(tooltipItems[0].parsed.x);
                                return date.toLocaleTimeString();
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });

    // Create MACD chart with improved styling
    const macdChartCtx = document.getElementById('macd-chart').getContext('2d');
    macdChart = new Chart(macdChartCtx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'MACD Line',
                    data: [],
                    borderColor: 'rgb(54, 130, 190)',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.1
                },
                {
                    label: 'Signal Line',
                    data: [],
                    borderColor: 'rgb(220, 53, 69)',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.1
                },
                {
                    label: 'Histogram',
                    data: [],
                    type: 'bar',
                    backgroundColor: function(context) {
                        const value = context.dataset.data[context.dataIndex];
                        return value && value.y < 0 ? 'rgba(220, 53, 69, 0.5)' : 'rgba(54, 130, 190, 0.5)';
                    },
                    borderColor: function(context) {
                        const value = context.dataset.data[context.dataIndex];
                        return value && value.y < 0 ? 'rgb(220, 53, 69)' : 'rgb(54, 130, 190)';
                    },
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0 // Disable animations
            },
            interaction: {
                intersect: false,
                mode: 'index'
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour',
                        displayFormats: {
                            hour: 'HH:mm',
                            minute: 'HH:mm:ss'
                        },
                        stepSize: 1
                    },
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'MACD'
                    },
                    grace: '5%'
                }
            },
            plugins: {
                legend: {
                    display: true
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: function(tooltipItems) {
                            if (tooltipItems.length > 0) {
                                const date = new Date(tooltipItems[0].parsed.x);
                                return date.toLocaleTimeString();
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
    
    console.log("Charts initialized");
}

// Set up event listeners
function setupEventListeners() {
    // Chart type toggle
    candlestickToggleBtn.addEventListener('click', () => {
        chartType = 'candlestick';
        updateChartButtons();
        if (lastData) {
            updateRealCharts(lastData);
        }
    });
    
    lineToggleBtn.addEventListener('click', () => {
        chartType = 'line';
        updateChartButtons();
        if (lastData) {
            updateRealCharts(lastData);
        }
    });
    
    maToggleBtn.addEventListener('click', () => {
        showMovingAverages = !showMovingAverages;
        maToggleBtn.classList.toggle('active');
        if (lastData) {
            updateRealCharts(lastData);
        }
    });
    
    // Simulation control
    startSimulationBtn.addEventListener('click', startSimulation);
    stopSimulationBtn.addEventListener('click', stopSimulation);
    speedControl.addEventListener('change', changeSimulationSpeed);
}

// Update chart type buttons
function updateChartButtons() {
    lineToggleBtn.classList.toggle('active', chartType === 'line');
    candlestickToggleBtn.classList.toggle('active', chartType === 'candlestick');
}

// Display connection error to help debugging
function showConnectionError(message) {
    connectionText.textContent = message || "Connection Error";
    connectionIndicator.className = "disconnected";
    console.error("Connection Error:", message);
    
    // Show alert to explain the file:// protocol issue
    if (window.location.protocol === "file:") {
        alert("Cannot establish WebSocket connection when using file:// protocol.\n\nPlease either:\n1. Serve this file through a web server (like python -m http.server 8080)\n2. Open this page via http://localhost:8080");
    }
}

// Connect to server
function connectToServer() {
    // Update connection UI
    updateConnectionStatus('connecting');
    
    // Check if we're using file:// protocol
    if (window.location.protocol === "file:") {
        console.warn("Running from file:// protocol - WebSocket connections may be blocked by the browser");
        document.body.classList.add("file-protocol-warning");
    }
    
    // Try to get initial data via HTTP
    fetch(HTTP_URL)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("Initial data received:", data);
            processData(data);
        })
        .catch(error => {
            console.error('Error fetching initial data:', error);
            if (error.message.includes('Failed to fetch')) {
                showConnectionError("Cannot connect to server. Make sure the server is running at " + SERVER_URL);
            }
        })
        .finally(() => {
            // Connect to WebSocket for real-time updates
            connectWebSocket();
        });
}

// Connect to WebSocket
function connectWebSocket() {
    // Close existing socket if any
    if (socket !== null) {
        socket.close();
    }
    
    // Create new WebSocket connection
    socket = new WebSocket(WS_URL);
    
    // WebSocket event handlers
    socket.onopen = () => {
        console.log('WebSocket connection established');
        updateConnectionStatus('connected');
        reconnectAttempts = 0;
        
        // Clear any pending reconnect timeout
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        
        // Set up a ping interval to keep the connection alive
        pingInterval = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000); // Ping every 30 seconds
    };
    
    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            // Handle pong message
            if (data.type === 'pong') {
                return;
            }
            
            // Process data update
            processData(data);
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };
    
    socket.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        updateConnectionStatus('disconnected');
        
        // Clear ping interval
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
        
        // Attempt to reconnect with backoff
        reconnectAttempts++;
        const delay = Math.min(30000, Math.pow(2, reconnectAttempts) * 1000); // Exponential backoff up to 30 seconds
        
        console.log(`Attempting to reconnect in ${delay/1000} seconds...`);
        reconnectTimeout = setTimeout(connectWebSocket, delay);
    };
    
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus('disconnected');
        showConnectionError("Failed to connect to server. See console for details.");
    };
}

// Update connection status UI
function updateConnectionStatus(status) {
    connectionIndicator.className = status;
    
    switch (status) {
        case 'connected':
            connectionText.textContent = 'Connected';
            break;
        case 'disconnected':
            connectionText.textContent = 'Disconnected';
            break;
        case 'connecting':
            connectionText.textContent = 'Connecting...';
            break;
        default:
            connectionText.textContent = status;
    }
}

// Process data received from the server
function processData(data) {
    if (!data) {
        console.log("Received empty data in processData");
        return;
    }
    
    // If we have trades, add them to our raw trade data
    if (data.trades && data.trades.length > 0) {
        rawTradeData = rawTradeData.concat(data.trades);
        // Limit the size to prevent memory issues
        if (rawTradeData.length > 10000) {
            rawTradeData = rawTradeData.slice(-10000);
        }
    }
    
    // Update minute data
    if (data.minute_aggregates && data.minute_aggregates.length > 0) {
        minuteData = data.minute_aggregates;
        
        // Store the data
        lastData = data;
        
        // Process the raw data to get a higher time resolution (10-second intervals)
        const enhancedData = enhanceTimeResolution(minuteData);
        
        // Update charts with enhanced data
        updateRealCharts(data, enhancedData);
    } else {
        console.log("No minute data in response or empty array");
    }
    
    // Update summary stats
    if (data.summary) {
        updateSummary(data.summary);
    }
    
    // Update last update time
    lastUpdateTimeElement.textContent = new Date().toLocaleTimeString();
}

// Enhance time resolution by creating intermediate points between minute data
function enhanceTimeResolution(minuteData) {
    if (!minuteData || minuteData.length < 2) return minuteData;
    
    const result = [];
    
    // Process each minute data point
    for (let i = 0; i < minuteData.length - 1; i++) {
        const current = minuteData[i];
        const next = minuteData[i + 1];
        
        // Add the current point
        result.push(current);
        
        // Get the dates
        const currentDate = new Date(current.minute);
        const nextDate = new Date(next.minute);
        
        // Calculate time difference in milliseconds
        const timeDiff = nextDate.getTime() - currentDate.getTime();
        
        // If time difference is greater than 10 seconds, create intermediate points
        if (timeDiff > 10000) { // 10 seconds in milliseconds
            const steps = Math.floor(timeDiff / 10000); // Number of 10-second intervals
            
            // Calculate price step per interval
            const priceStep = (next.close_price - current.close_price) / steps;
            const volumeStep = (next.volume - current.volume) / steps;
            
            // Create intermediate points
            for (let j = 1; j < steps; j++) {
                const intermediateTime = new Date(currentDate.getTime() + j * 10000);
                const intermediatePrice = parseFloat(current.close_price) + j * priceStep;
                const intermediateVolume = Math.round(parseInt(current.volume) + j * volumeStep);
                
                result.push({
                    minute: intermediateTime.toISOString(),
                    min_price: intermediatePrice - (Math.random() * 0.05), // Add slight variation
                    max_price: intermediatePrice + (Math.random() * 0.05),
                    open_price: intermediatePrice - (Math.random() * 0.03),
                    close_price: intermediatePrice,
                    volume: intermediateVolume,
                    trade_count: Math.round(current.trade_count / steps),
                    vwap: intermediatePrice + (Math.random() * 0.02 - 0.01) // Slight variation
                });
            }
        }
    }
    
    // Add the last point
    result.push(minuteData[minuteData.length - 1]);
    
    return result;
}

// Update summary statistics
function updateSummary(summary) {
    // Format price with 2 decimal places
    const formatPrice = (price) => price !== null ? parseFloat(price).toFixed(2) : '--';
    
    // Format volume with commas for thousands
    const formatVolume = (volume) => volume !== null ? parseInt(volume).toLocaleString() : '--';
    
    // Update DOM elements
    lastPriceElement.textContent = formatPrice(summary.last_price);
    openingPriceElement.textContent = formatPrice(summary.opening_price);
    dayHighElement.textContent = formatPrice(summary.day_high);
    dayLowElement.textContent = formatPrice(summary.day_low);
    totalVolumeElement.textContent = formatVolume(summary.total_volume);
    tradeCountElement.textContent = formatVolume(summary.trade_count);
    
    // Change color based on price direction
    if (summary.last_price > summary.opening_price) {
        lastPriceElement.style.color = '#28a745'; // Green for up
    } else if (summary.last_price < summary.opening_price) {
        lastPriceElement.style.color = '#dc3545'; // Red for down
    } else {
        lastPriceElement.style.color = '#2c3e50'; // Default color
    }
}

// Find min and max values across all datasets with extra padding
function findYAxisRange(datasets, paddingPercent = 10) {
    if (!datasets || datasets.length === 0) return { min: null, max: null };
    
    let allValues = [];
    datasets.forEach(dataset => {
        if (dataset && dataset.data) {
            allValues = allValues.concat(dataset.data.map(d => d.y));
        }
    });
    
    if (allValues.length === 0) return { min: null, max: null };
    
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    
    // Calculate padding
    const range = max - min;
    const padding = (range * paddingPercent) / 100;
    
    return {
        min: min - padding,
        max: max + padding
    };
}

// Create candlestick data from our minute data
function createCandlestickData(dataToUse) {
    if (!dataToUse || dataToUse.length === 0) {
        return [];
    }
    
    const candlestickData = [];
    
    dataToUse.forEach(item => {
        // Create a valid date object
        let dateObj;
        try {
            dateObj = new Date(item.minute);
            if (isNaN(dateObj.getTime())) {
                return;
            }
        } catch (e) {
            return;
        }
        
        // Only include points within trading hours (4 AM to 4 PM)
        const hour = dateObj.getHours();
        if (hour >= 4 && hour <= 16) {
            candlestickData.push({
                x: dateObj,
                o: parseFloat(item.open_price),  // Open price
                h: parseFloat(item.max_price),   // High price
                l: parseFloat(item.min_price),   // Low price
                c: parseFloat(item.close_price)  // Close price
            });
        }
    });
    
    // Sort candlestick data by time
    candlestickData.sort((a, b) => a.x - b.x);
    
    return candlestickData;
}

// Create a custom bar-based implementation of candlesticks
function createCustomCandlestickChart(ctx, data, options) {
    // Destroy existing chart if any
    if (priceChart) {
        priceChart.destroy();
    }
    
    // Create a new chart using bar chart type with custom rendering for candlesticks
    return new Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [{
                label: 'AAPL OHLC',
                data: data.map(item => ({
                    x: item.x,
                    y: (item.h + item.l) / 2, // Center point for positioning
                    open: item.o,
                    high: item.h,
                    low: item.l,
                    close: item.c
                })),
                backgroundColor: function(context) {
                    if (!context.raw) return 'rgba(0, 0, 0, 0.8)';
                    const open = context.raw.open;
                    const close = context.raw.close;
                    return open <= close ? 'rgba(40, 167, 69, 0.8)' : 'rgba(220, 53, 69, 0.8)';
                },
                borderColor: function(context) {
                    if (!context.raw) return 'rgba(0, 0, 0, 1)';
                    const open = context.raw.open;
                    const close = context.raw.close;
                    return open <= close ? 'rgba(40, 167, 69, 1)' : 'rgba(220, 53, 69, 1)';
                },
                borderWidth: 1,
                barPercentage: 0.8,
                categoryPercentage: 0.8
            }]
        },
        options: options,
        plugins: [{
            id: 'candlestickDrawer',
            beforeDatasetsDraw: function(chart) {
                const ctx = chart.ctx;
                const meta = chart.getDatasetMeta(0);
                
                if (!meta.data) return;
                
                ctx.save();
                ctx.lineWidth = 1;
                
                meta.data.forEach((bar, index) => {
                    const data = chart.data.datasets[0].data[index];
                    if (!data) return;
                    
                    const x = bar.x;
                    const width = bar.width;
                    const centerX = x;
                    
                    // Get y positions
                    const highY = chart.scales.y.getPixelForValue(data.high);
                    const lowY = chart.scales.y.getPixelForValue(data.low);
                    const openY = chart.scales.y.getPixelForValue(data.open);
                    const closeY = chart.scales.y.getPixelForValue(data.close);
                    
                    // Determine colors based on whether it's an up or down candle
                    const isUp = data.close >= data.open;
                    ctx.strokeStyle = isUp ? 'rgba(40, 167, 69, 1)' : 'rgba(220, 53, 69, 1)';
                    
                    // Draw the high-low wick line
                    ctx.beginPath();
                    ctx.moveTo(centerX, highY);
                    ctx.lineTo(centerX, lowY);
                    ctx.stroke();
                    
                    // Calculate bar top and height (but don't redeclare)
                    const barTop = Math.min(openY, closeY);
                    const barHeight = Math.abs(openY - closeY);
                    
                    // If open and close are very close, ensure a minimum height
                    if (barHeight < 1) {
                        ctx.fillRect(x - width/2, barTop - 0.5, width, 1);
                    }
                });
                
                ctx.restore();
            }
        }]
    });
}

// Add this function to aggregate high-frequency data
function aggregateCandlestickData(dataToUse, timeInterval = 5) {
    if (!dataToUse || dataToUse.length === 0) {
        return [];
    }
    
    // Group data by time interval (e.g., 5-minute buckets)
    const groupedData = {};
    
    dataToUse.forEach(item => {
        let dateObj;
        try {
            dateObj = new Date(item.minute);
            if (isNaN(dateObj.getTime())) {
                return;
            }
        } catch (e) {
            return;
        }
        
        // Only include points within trading hours (4 AM to 4 PM)
        const hour = dateObj.getHours();
        if (hour >= 4 && hour <= 16) {
            // Round to nearest timeInterval minutes
            const minutes = dateObj.getMinutes();
            const roundedMinutes = Math.floor(minutes / timeInterval) * timeInterval;
            
            // Create new date with rounded minutes for grouping
            const roundedDate = new Date(dateObj);
            roundedDate.setMinutes(roundedMinutes, 0, 0);
            
            // Use timestamp as key for grouping
            const key = roundedDate.getTime();
            
            if (!groupedData[key]) {
                groupedData[key] = {
                    minute: roundedDate,
                    open_prices: [],
                    high_prices: [],
                    low_prices: [],
                    close_prices: [],
                    volumes: []
                };
            }
            
            groupedData[key].open_prices.push(parseFloat(item.open_price));
            groupedData[key].high_prices.push(parseFloat(item.max_price));
            groupedData[key].low_prices.push(parseFloat(item.min_price));
            groupedData[key].close_prices.push(parseFloat(item.close_price));
            groupedData[key].volumes.push(parseInt(item.volume) || 0);
        }
    });
    
    // Convert grouped data to OHLC format
    const aggregatedData = Object.keys(groupedData).map(key => {
        const group = groupedData[key];
        
        return {
            x: group.minute,
            o: group.open_prices[0], // First open price in the interval
            h: Math.max(...group.high_prices),
            l: Math.min(...group.low_prices),
            c: group.close_prices[group.close_prices.length - 1], // Last close price in the interval
            volume: group.volumes.reduce((sum, vol) => sum + vol, 0)
        };
    });
    
    // Sort by time
    aggregatedData.sort((a, b) => a.x - b.x);
    
    return aggregatedData;
}

// Update charts with real data and enhanced resolution
function updateRealCharts(data, enhancedData) {
    try {
        // Use enhanced data if available, otherwise use regular minute data
        const dataToUse = enhancedData || minuteData;
        
        if (!dataToUse || dataToUse.length === 0) {
            console.log("No data to display");
            return;
        }
        
        // Set time range (fixed trading hours)
        const baseDate = new Date(dataToUse[0].minute);
        baseDate.setHours(0, 0, 0, 0); // Reset to start of day
        
        const startTime = new Date(baseDate);
        startTime.setHours(4, 0, 0, 0);  // 4 AM
        
        const endTime = new Date(baseDate);
        endTime.setHours(16, 0, 0, 0);   // 4 PM
        
        // Handle different chart types
        if (chartType === 'line') {
            // Process price data for line chart
            const priceData = [];
            
            dataToUse.forEach(item => {
                // Create a valid date object
                let dateObj;
                try {
                    dateObj = new Date(item.minute);
                    if (isNaN(dateObj.getTime())) {
                        return;
                    }
                } catch (e) {
                    return;
                }
                
                // Only include points within trading hours (4 AM to 4 PM)
                const hour = dateObj.getHours();
                if (hour >= 4 && hour <= 16) {
                    priceData.push({
                        x: dateObj,
                        y: parseFloat(item.close_price)
                    });
                }
            });
            
            // Sort price data by time
            priceData.sort((a, b) => a.x - b.x);
            
            // Only continue if we have data
            if (priceData.length === 0) {
                console.log("No price data to display");
                return;
            }
            
            // Update chart type and data
            if (priceChart && priceChart.config.type !== 'line') {
                // Destroy current chart and recreate as line chart
                priceChart.destroy();
                const priceChartCtx = document.getElementById('price-chart').getContext('2d');
                priceChart = new Chart(priceChartCtx, {
                    type: 'line',
                    data: {
                        datasets: [{
                            label: 'AAPL Price',
                            data: priceData,
                            borderColor: 'rgba(54, 130, 190, 1)', // Pleasant blue
                            backgroundColor: 'rgba(54, 130, 190, 0.1)',
                            borderWidth: 2,
                            pointRadius: 0, // No dots
                            fill: false,
                            tension: 0.1 // Slight smoothing
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: {
                            duration: 0 // Disable animations
                        },
                        interaction: {
                            intersect: false, // Enable hover-anywhere
                            mode: 'index'     // Show all values at current x position
                        },
                        scales: {
                            x: {
                                type: 'time',
                                time: {
                                    unit: 'minute',
                                    stepSize: 10,
                                    displayFormats: {
                                        minute: 'HH:mm',
                                        hour: 'HH:mm'
                                    },
                                },
                                title: {
                                    display: true,
                                    text: 'Time'
                                },
                                min: startTime,
                                max: endTime
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: 'Price'
                                },
                                grace: '5%' // Add padding to min and max
                            }
                        },
                        plugins: {
                            legend: {
                                display: true,
                                labels: {
                                    filter: function(legendItem, chartData) {
                                        const labels = chartData.datasets.map(dataset => dataset.label);
                                        return labels.indexOf(legendItem.text) === legendItem.datasetIndex;
                                    }
                                }
                            },
                            tooltip: {
                                mode: 'index',
                                intersect: false,
                                callbacks: {
                                    title: function(tooltipItems) {
                                        if (tooltipItems.length > 0) {
                                            const date = new Date(tooltipItems[0].parsed.x);
                                            return date.toLocaleTimeString();
                                        }
                                        return '';
                                    },
                                    label: function(context) {
                                        let label = context.dataset.label || '';
                                        if (label) {
                                            label += ': ';
                                        }
                                        if (context.parsed.y !== null) {
                                            label += context.parsed.y.toFixed(2); // Show 2 decimal places
                                        }
                                        return label;
                                    }
                                }
                            }
                        }
                    }
                });
            } else if (priceChart) {
                // Update existing line chart data
                priceChart.data.datasets[0].data = priceData;
                priceChart.options.scales.x.min = startTime;
                priceChart.options.scales.x.max = endTime;
            }
            
            // Moving Averages
            if (priceChart && showMovingAverages && data && data.moving_averages) {
                // Reset moving averages datasets
                priceChart.data.datasets = [priceChart.data.datasets[0]];
                
                // Add 10-Period MA
                if (data.moving_averages.MA10) {
                    const ma10Data = [];
                    
                    // Create interpolated MA10 data to match enhanced resolution
                    if (enhancedData) {
                        // For each enhanced data point, find or interpolate MA10 value
                        enhancedData.forEach((item, index) => {
                            const dateObj = new Date(item.minute);
                            const hour = dateObj.getHours();
                            
                            if (hour >= 4 && hour <= 16) {
                                // Find closest minute data point
                                const minuteIndex = minuteData.findIndex(m => {
                                    const mDate = new Date(m.minute);
                                    return mDate >= dateObj;
                                });
                                
                                if (minuteIndex >= 0 && data.moving_averages.MA10[minuteIndex]) {
                                    ma10Data.push({
                                        x: dateObj,
                                        y: parseFloat(data.moving_averages.MA10[minuteIndex])
                                    });
                                }
                            }
                        });
                    } else {
                        // Use regular MA10 data
                        Object.entries(data.moving_averages.MA10).forEach(([index, value]) => {
                            const dateIndex = parseInt(index);
                            if (dateIndex < minuteData.length) {
                                const date = new Date(minuteData[dateIndex].minute);
                                const hour = date.getHours();
                                
                                if (hour >= 4 && hour <= 16) {
                                    ma10Data.push({
                                        x: date,
                                        y: parseFloat(value)
                                    });
                                }
                            }
                        });
                    }
                    
                    if (ma10Data.length > 0) {
                        ma10Data.sort((a, b) => a.x - b.x);
                        priceChart.data.datasets.push({
                            label: '10-Period MA',
                            data: ma10Data,
                            borderColor: 'rgba(220, 53, 69, 1)', // Red
                            backgroundColor: 'rgba(220, 53, 69, 0.1)',
                            borderWidth: 2,
                            pointRadius: 0,
                            fill: false,
                            tension: 0.1
                        });
                    }
                }
                
                // Add 20-Period MA (similar approach)
                if (data.moving_averages.MA20) {
                    const ma20Data = [];
                    
                    // Create interpolated MA20 data to match enhanced resolution
                    if (enhancedData) {
                        enhancedData.forEach((item, index) => {
                            const dateObj = new Date(item.minute);
                            const hour = dateObj.getHours();
                            
                            if (hour >= 4 && hour <= 16) {
                                const minuteIndex = minuteData.findIndex(m => {
                                    const mDate = new Date(m.minute);
                                    return mDate >= dateObj;
                                });
                                
                                if (minuteIndex >= 0 && data.moving_averages.MA20[minuteIndex]) {
                                    ma20Data.push({
                                        x: dateObj,
                                        y: parseFloat(data.moving_averages.MA20[minuteIndex])
                                    });
                                }
                            }
                        });
                    } else {
                        Object.entries(data.moving_averages.MA20).forEach(([index, value]) => {
                            const dateIndex = parseInt(index);
                            if (dateIndex < minuteData.length) {
                                const date = new Date(minuteData[dateIndex].minute);
                                const hour = date.getHours();
                                
                                if (hour >= 4 && hour <= 16) {
                                    ma20Data.push({
                                        x: date,
                                        y: parseFloat(value)
                                    });
                                }
                            }
                        });
                    }
                    
                    if (ma20Data.length > 0) {
                        ma20Data.sort((a, b) => a.x - b.x);
                        priceChart.data.datasets.push({
                            label: '20-Period MA',
                            data: ma20Data,
                            borderColor: 'rgba(255, 193, 7, 1)', // Gold/amber
                            backgroundColor: 'rgba(255, 193, 7, 0.1)',
                            borderWidth: 2,
                            pointRadius: 0,
                            fill: false,
                            tension: 0.1
                        });
                    }
                }
            } else if (priceChart && priceChart.data.datasets && priceChart.data.datasets.length > 1) {
                // Remove moving averages if they're present but shouldn't be
                priceChart.data.datasets = [priceChart.data.datasets[0]];
            }
            
            // Find appropriate y-axis range across all datasets
            if (priceChart && priceChart.data.datasets) {
                const yRange = findYAxisRange(priceChart.data.datasets, 5);
                if (yRange.min !== null && yRange.max !== null) {
                    priceChart.options.scales.y.min = yRange.min;
                    priceChart.options.scales.y.max = yRange.max;
                }
            }
            
            // Update chart
            if (priceChart) {
                priceChart.update('none');
            }
            
        } else if (chartType === 'candlestick') {
            // Process data for candlestick chart
            const rawCandlestickData = createCandlestickData(dataToUse);
            
            // Aggregate the data into 5-minute intervals for better visualization
            // Adjust the time interval (second parameter) based on your data frequency
            const candlestickData = aggregateCandlestickData(dataToUse, 5);
            
            if (candlestickData.length === 0) {
                console.log("No candlestick data to display");
                return;
            }
            
            console.log("Rendering candlestick chart with aggregated data points:", candlestickData.length);
            
            // Destroy existing chart if any
            if (priceChart) {
                priceChart.destroy();
            }
            
            const priceChartCtx = document.getElementById('price-chart').getContext('2d');
            
            // Create a scatter chart to have more control over individual points
            priceChart = new Chart(priceChartCtx, {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: 'AAPL OHLC',
                        data: candlestickData,
                        showLine: false // No lines between points
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {
                        duration: 0 // Disable animations
                    },
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                unit: 'minute',
                                stepSize: 10,
                                displayFormats: {
                                    minute: 'HH:mm',
                                    hour: 'HH:mm'
                                },
                            },
                            title: {
                                display: true,
                                text: 'Time'
                            },
                            min: startTime,
                            max: endTime
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Price'
                            },
                            grace: '5%' // Add padding to min and max
                        }
                    },
                    plugins: {
                        legend: {
                            display: true
                        },
                        tooltip: {
                            mode: 'nearest',
                            intersect: false,
                            callbacks: {
                                title: function(tooltipItems) {
                                    if (tooltipItems.length > 0) {
                                        const date = new Date(tooltipItems[0].raw.x);
                                        return date.toLocaleTimeString();
                                    }
                                    return '';
                                },
                                label: function(context) {
                                    if (context.raw) {
                                        const data = context.raw;
                                        return [
                                            'Open: ' + data.o.toFixed(2),
                                            'High: ' + data.h.toFixed(2),
                                            'Low: ' + data.l.toFixed(2),
                                            'Close: ' + data.c.toFixed(2)
                                        ];
                                    }
                                    return '';
                                }
                            }
                        }
                    }
                },
                plugins: [{
                    id: 'candlestickDrawer',
                    beforeDatasetsDraw: function(chart) {
                        const ctx = chart.ctx;
                        const meta = chart.getDatasetMeta(0);
                        
                        // Exit if no data points
                        if (!meta.data || meta.data.length === 0) return;
                        
                        ctx.save();
                        ctx.lineWidth = 1;
                        
                        meta.data.forEach((point, index) => {
                            const data = chart.data.datasets[0].data[index];
                            if (!data) return;
                            
                            const x = point.x;
                            const centerX = x;
                            
                            // Get y positions 
                            const highY = chart.scales.y.getPixelForValue(data.h);
                            const lowY = chart.scales.y.getPixelForValue(data.l);
                            const openY = chart.scales.y.getPixelForValue(data.o);
                            const closeY = chart.scales.y.getPixelForValue(data.c);
                            
                            // Determine if bullish or bearish candle
                            const isBullish = data.c >= data.o;
                            ctx.strokeStyle = isBullish ? 'rgba(40, 167, 69, 1)' : 'rgba(220, 53, 69, 1)';
                            ctx.fillStyle = isBullish ? 'rgba(40, 167, 69, 0.8)' : 'rgba(220, 53, 69, 0.8)';
                            
                            // Draw the high-low wick line
                            ctx.beginPath();
                            ctx.moveTo(centerX, highY);
                            ctx.lineTo(centerX, lowY);
                            ctx.stroke();
                            
                            // Draw the candle body (rectangle)
                            // Calculate a good width based on data density (min 6px, max 15px)
                            const candleWidth = Math.min(15, Math.max(6, 
                                chart.chartArea.width / Math.max(20, chart.data.datasets[0].data.length)
                            ));
                            
                            const bodyTop = Math.min(openY, closeY);
                            const bodyHeight = Math.max(1, Math.abs(openY - closeY)); // Ensure minimum 1px height
                            
                            ctx.fillRect(centerX - candleWidth/2, bodyTop, candleWidth, bodyHeight);
                            ctx.strokeRect(centerX - candleWidth/2, bodyTop, candleWidth, bodyHeight);
                        });
                        
                        ctx.restore();
                    }
                }]
            });
            
            // Add Moving Averages if enabled
            if (showMovingAverages && data && data.moving_averages) {
                setTimeout(() => {
                    // Add 10-Period MA
                    if (data.moving_averages.MA10) {
                        const ma10Data = [];
                        
                        // Create MA10 data points
                        Object.entries(data.moving_averages.MA10).forEach(([index, value]) => {
                            const dateIndex = parseInt(index);
                            if (dateIndex < minuteData.length) {
                                const date = new Date(minuteData[dateIndex].minute);
                                const hour = date.getHours();
                                
                                if (hour >= 4 && hour <= 16) {
                                    ma10Data.push({
                                        x: date,
                                        y: parseFloat(value)
                                    });
                                }
                            }
                        });
                        
                        if (ma10Data.length > 0) {
                            ma10Data.sort((a, b) => a.x - b.x);
                            // Add line dataset for MA10
                            priceChart.data.datasets.push({
                                type: 'line',
                                label: '10-Period MA',
                                data: ma10Data,
                                borderColor: 'rgba(220, 53, 69, 1)', // Red 
                                backgroundColor: 'rgba(220, 53, 69, 0.1)',
                                borderWidth: 2,
                                pointRadius: 0,
                                fill: false,
                                tension: 0.1
                            });
                        }
                    }
                    
                    // Add 20-Period MA
                    if (data.moving_averages.MA20) {
                        const ma20Data = [];
                        
                        Object.entries(data.moving_averages.MA20).forEach(([index, value]) => {
                            const dateIndex = parseInt(index);
                            if (dateIndex < minuteData.length) {
                                const date = new Date(minuteData[dateIndex].minute);
                                const hour = date.getHours();
                                
                                if (hour >= 4 && hour <= 16) {
                                    ma20Data.push({
                                        x: date,
                                        y: parseFloat(value)
                                    });
                                }
                            }
                        });
                        
                        if (ma20Data.length > 0) {
                            ma20Data.sort((a, b) => a.x - b.x);
                            // Add line dataset for MA20
                            priceChart.data.datasets.push({
                                type: 'line',
                                label: '20-Period MA',
                                data: ma20Data,
                                borderColor: 'rgba(255, 193, 7, 1)', // Gold/amber
                                backgroundColor: 'rgba(255, 193, 7, 0.1)',
                                borderWidth: 2,
                                pointRadius: 0,
                                fill: false,
                                tension: 0.1
                            });
                        }
                    }
                    
                    priceChart.update('none');
                }, 0);
            }
            
            // Calculate appropriate y-axis range
            const allPrices = candlestickData.reduce((acc, candle) => {
                acc.push(candle.h, candle.l, candle.o, candle.c);
                return acc;
            }, []);
            
            if (allPrices.length > 0) {
                const min = Math.min(...allPrices);
                const max = Math.max(...allPrices);
                const range = max - min;
                const padding = (range * 5) / 100; // 5% padding
                
                priceChart.options.scales.y.min = min - padding;
                priceChart.options.scales.y.max = max + padding;
                priceChart.update('none');
            }
        }
        
        // Update volume chart with similar approach
        const volumeData = [];
        
        dataToUse.forEach(item => {
            let dateObj;
            try {
                dateObj = new Date(item.minute);
                if (isNaN(dateObj.getTime())) {
                    return;
                }
            } catch (e) {
                return;
            }
            
            const hour = dateObj.getHours();
            if (hour >= 4 && hour <= 16) {
                volumeData.push({
                    x: dateObj,
                    y: parseInt(item.volume)
                });
            }
        });
        
        volumeData.sort((a, b) => a.x - b.x);
        
        if (volumeChart) {
            volumeChart.data.datasets[0].data = volumeData;
            volumeChart.options.scales.x.min = startTime;
            volumeChart.options.scales.x.max = endTime;
            volumeChart.update('none');
        }
        
        // Update MACD chart
        if (macdChart && data.macd && data.macd.macd_line && data.macd.signal_line && data.macd.histogram) {
            const macdLineData = [];
            const signalLineData = [];
            const histogramData = [];
            
            // Similar approach for MACD with interpolation for enhanced data
            if (enhancedData) {
                enhancedData.forEach((item, index) => {
                    const dateObj = new Date(item.minute);
                    const hour = dateObj.getHours();
                    
                    if (hour >= 4 && hour <= 16) {
                        const minuteIndex = minuteData.findIndex(m => {
                            const mDate = new Date(m.minute);
                            return mDate >= dateObj;
                        });
                        
                        if (minuteIndex >= 0) {
                            if (data.macd.macd_line[minuteIndex]) {
                                macdLineData.push({
                                    x: dateObj,
                                    y: parseFloat(data.macd.macd_line[minuteIndex])
                                });
                            }
                            
                            if (data.macd.signal_line[minuteIndex]) {
                                signalLineData.push({
                                    x: dateObj,
                                    y: parseFloat(data.macd.signal_line[minuteIndex])
                                });
                            }
                            
                            if (data.macd.histogram[minuteIndex]) {
                                histogramData.push({
                                    x: dateObj,
                                    y: parseFloat(data.macd.histogram[minuteIndex])
                                });
                            }
                        }
                    }
                });
            } else {
                Object.entries(data.macd.macd_line).forEach(([index, value]) => {
                    const dateIndex = parseInt(index);
                    if (dateIndex < minuteData.length) {
                        const date = new Date(minuteData[dateIndex].minute);
                        const hour = date.getHours();
                        
                        if (hour >= 4 && hour <= 16) {
                            macdLineData.push({
                                x: date,
                                y: parseFloat(value)
                            });
                            
                            if (data.macd.signal_line[index]) {
                                signalLineData.push({
                                    x: date,
                                    y: parseFloat(data.macd.signal_line[index])
                                });
                            }
                            
                            if (data.macd.histogram[index]) {
                                histogramData.push({
                                    x: date,
                                    y: parseFloat(data.macd.histogram[index])
                                });
                            }
                        }
                    }
                });
            }
            
            // Sort and update
            macdLineData.sort((a, b) => a.x - b.x);
            signalLineData.sort((a, b) => a.x - b.x);
            histogramData.sort((a, b) => a.x - b.x);
            
            macdChart.data.datasets[0].data = macdLineData;
            macdChart.data.datasets[1].data = signalLineData;
            macdChart.data.datasets[2].data = histogramData;
            
            macdChart.options.scales.x.min = startTime;
            macdChart.options.scales.x.max = endTime;
            
            // Find appropriate y-axis range for MACD
            const macdYRange = findYAxisRange(macdChart.data.datasets, 10);
            if (macdYRange.min !== null && macdYRange.max !== null) {
                macdChart.options.scales.y.min = macdYRange.min;
                macdChart.options.scales.y.max = macdYRange.max;
            }
            
            macdChart.update('none');
        }
        
    } catch (error) {
        console.error("Error updating charts with real data:", error);
    }
}

// Start simulation
function startSimulation() {
    console.log("Starting simulation");
    
    fetch('http://localhost:8000/simulation/control', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: 'start'
        })
    })
    .then(response => response.json())
    .then(data => {
        console.log("Simulation started:", data);
    })
    .catch(error => {
        console.error("Error starting simulation:", error);
        alert("Failed to start simulation. Check console for details.");
    });
}

// Stop simulation
function stopSimulation() {
    console.log("Stopping simulation");
    
    fetch('http://localhost:8000/simulation/control', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: 'stop'
        })
    })
    .then(response => response.json())
    .then(data => {
        console.log("Simulation stopped:", data);
    })
    .catch(error => {
        console.error("Error stopping simulation:", error);
        alert("Failed to stop simulation. Check console for details.");
    });
}

// Change simulation speed
function changeSimulationSpeed() {
    const speed = parseFloat(speedControl.value);
    console.log("Changing simulation speed to", speed);
    
    fetch('http://localhost:8000/simulation/control', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: 'speed',
            speed: speed
        })
    })
    .then(response => response.json())
    .then(data => {
        console.log("Simulation speed changed:", data);
    })
    .catch(error => {
        console.error("Error changing simulation speed:", error);
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);