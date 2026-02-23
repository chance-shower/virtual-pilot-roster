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

    if (!flightData) {
        alert("Flight schedules are still loading - please try again in a few seconds...");
    }
    // Get user input
    const airline = document.getElementById('airlineCode').value.toUpperCase().trim();
    // Handle multiple aircraft
    const equipment = document.getElementById('equipmentCode').value
        .split(',')
        .map(s => s.trim().toUpperCase());
    const homeBase = document.getElementById('homeBase').value.toUpperCase().trim();
    const dutyLength = document.getElementById('dutyLength').value;
    const desiredAirports = document.getElementById('desiredAirports')?.value
        .split(',')
        .map(s => s.trim().toUpperCase());
    const excludedAirports = document.getElementById('excludedAirports')?.value
        .split(',')
        .map(s => s.trim().toUpperCase());

    // Show spinner while timetable is generated
    document.getElementById('loader-overlay').style.display = 'flex';

    // Build first route

    try {
        // Filter by homebase and airline to start
        const firstLegData = flightData[homeBase]?.[airline];
        if (!firstLegData) throw `No flights found for ${airline} at ${homeBase}...`;

        // Filter all flights from above for the chosen aircraft type
        let pool = [];
        equipment.forEach(aircraft => {
            if (firstLegData[aircraft]) {
                Object.keys(firstLegData[aircraft]).forEach(dest => {
                    firstLegData[aircraft][dest].forEach(flt => {
                        pool.push({ ...flt, dep: homeBase, arr: dest, equip: aircraft});
                    });
                });
            }      
        });
    }

}