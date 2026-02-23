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
    // 1. Safety check - must return to stop execution
    if (!flightData) {
        alert("Flight schedules are still loading - please try again in a few seconds...");
        return; 
    }

    // 2. Get user input with safety checks for optional fields
    const airline = document.getElementById('airlineCode').value.toUpperCase().trim();
    const homeBase = document.getElementById('homeBase').value.toUpperCase().trim();
    const equipment = document.getElementById('equipmentCode').value
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(s => s !== ""); // Remove empty strings if user typed "B738, "

    // Safety for optional inputs: only map if value exists
    const desiredInput = document.getElementById('desiredAirports')?.value;
    const desiredAirports = desiredInput ? desiredInput.split(',').map(s => s.trim().toUpperCase()).filter(s => s !== "") : [];

    const excludedInput = document.getElementById('excludedAirports')?.value;
    const excludedAirports = excludedInput ? excludedInput.split(',').map(s => s.trim().toUpperCase()).filter(s => s !== "") : [];

    // 3. Show spinner
    document.getElementById('loader-overlay').style.display = 'flex';

    try {
        // Navigate JSON
        const firstLegData = flightData[homeBase]?.[airline];
        if (!firstLegData) throw `No flights found for ${airline} at ${homeBase}...`;

        let pool = [];
        equipment.forEach(aircraft => {
            if (firstLegData[aircraft]) {
                Object.keys(firstLegData[aircraft]).forEach(dest => {
                    // Check if destination is in excluded list
                    if (excludedAirports.includes(dest)) return;
                    firstLegData[aircraft][dest].forEach(flt => {
                        pool.push({ ...flt, dep: homeBase, arr: dest, equip: aircraft });
                    });
                });
            }      
        });

        console.log(pool);

        if (pool.length === 0) throw "No flights found for the specified aircraft types...";

        // 5. Time filtering (0500-1000 or 1300-1700)
        const preferredFlights = pool.filter(f => {
            const depMins = toMins(f.dep_local);
            const isMorning = depMins >= 300 && depMins <= 600;
            const isAfternoon = depMins >= 780 && depMins <= 1020;
            
            // Boost preference if the airport is in desiredAirports
            const isDesired = desiredAirports.includes(f.arr);
            
            return isMorning || isAfternoon || isDesired;
        });

        console.log(preferredFlights);

        // Final selection
        const sourcePool = preferredFlights.length > 0 ? preferredFlights : pool;
        const firstFlight = sourcePool[Math.floor(Math.random() * sourcePool.length)];

        // Update UI
        console.log(firstFlight);

        renderTable([firstFlight]);

        document.getElementById('startPage').style.display = 'none';
        document.getElementById('flightSchedule').style.display = 'block';

    } catch (err) {
        console.error(err);
        alert(err);
    } finally {
        document.getElementById('loader-overlay').style.display = 'none';
    }
}

// Render first leg into table

function renderTable(legs) {
    const tbody = document.getElementById('rosterTableBody');
    tbody.innerHTML = ""; 

    legs.forEach((leg, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${document.getElementById('airlineCode').value.toUpperCase()}</td>
            <td>${leg.callsign}</td>
            <td>${leg.equip}</td>
            <td>${leg.dep}</td>
            <td>${leg.arr}</td>
            <td>-</td>
            <td>-</td>
            <td>${leg.dep_local}</td>
            <td>${leg.std_utc || leg.dep_utc}</td>
            <td>${leg.arr_local}</td>
            <td>${leg.sta_utc || leg.arr_utc}</td>
            <td>-</td>
            <td>-</td>
        `;
        tbody.appendChild(row);
    });

    // Preamble sentence here
    const tripDays = document.getElementById('dutyLength').value;
    const homeBase = document.getElementById('homeBase').value.toUpperCase().trim();
    const equipment = document.getElementById('equipmentCode').value;

    document.getElementById('preamble').innerHTML = `Here is your ${tripDays} day trip, based at ${homeBase}, flying the ${equipment}`
}

function closeToWelcomeScreen() {
    document.getElementById('startPage').style.display = 'block';
    document.getElementById('flightSchedule').style.display = 'none';
}

// Event listeners
document.getElementById('generateFlightRoster').addEventListener('click', createTrip);

document.getElementById('closethisflighttrip').addEventListener('click', closeToWelcomeScreen)