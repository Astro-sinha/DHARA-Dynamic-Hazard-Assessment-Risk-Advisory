#!/bin/bash
# Change directory to the folder where this script is located
cd "$(dirname "$0")"

echo "============================================================"
echo "  DHARA — AI/ML Landslide Early Warning System"
echo "  Flask Backend + ML REST API"
echo "============================================================"
echo ""
echo "Installing Python dependencies..."
python3 -m pip install -r requirements.txt
echo ""
echo "Starting Flask server at http://localhost:5001 ..."
echo "Open your browser and go to: http://localhost:5001"
echo ""
python3 server.py --port 5001

# Keep terminal open if the server stops or crashes
echo ""
echo "Press any key to close this terminal window..."
read -n 1 -s
