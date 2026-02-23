let flightData = null;

// Convert HH:mm to total minutes
const toMins = (timeStr) => {
    const [h,m] = timeStr.split(':').map(Number);
    return h * 60 + m;
};

// Function and call to load data

async function loadFlightData() {
    try {
        const response = await fetch('data/flight_schedules_202212.json');
        if (!response.ok) throw new Error("Issue reading data (1)");
        flightData = await response.json();
        console.log("Database loaded");
    } catch (error) {
        console.error("Issue reading data (2)");
    }
}

loadFlightData();

// Function to generate roster

async function createTrip() {
    // Get user input
    const airline = document.getElementById('airlineCode').value;
    const equipment = document.getElementById('equipmentCode').value;
    const homeBase = document.getElementById('homeBase').value;
    const dutyLength = document.getElementById('dutyLength').value;
    const desiredAirports = document.getElementById('desiredAirports')?.value;
    const excludedAirports = document.getElementById('excludedAirports')?.value;

    // Show spinner while timetable is generated
    document.getElementById('loader-overlay').style.display = 'flex';

    //try {
    //    const baseData = flightData[homeBase]?.[airline];
    //}

}