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
    const dutyLength = parseInt(document.getElementById('dutyLength').value) || 4;

    // Safety for optional inputs: only map if value exists
    const desiredInput = document.getElementById('desiredAirports')?.value;
    const desiredAirports = desiredInput ? desiredInput.split(',').map(s => s.trim().toUpperCase()).filter(s => s !== "") : [];

    const excludedInput = document.getElementById('excludedAirports')?.value;
    const excludedAirports = excludedInput ? excludedInput.split(',').map(s => s.trim().toUpperCase()).filter(s => s !== "") : [];

    // 3. Show spinner
    document.getElementById('loader-overlay').style.display = 'flex';

    try {
        let roster = [];
        let currentCity = homeBase;
        let currentTimeMins = 0; 
        
        // Let's target 4 legs for a standard short-haul day for now
        const targetLegs = 4;

        for (let i = 0; i < targetLegs; i++) {
            const possibleData = flightData[currentCity]?.[airline];
            if (!possibleData) break;

            let legPool = [];
            equipment.forEach(ac => {
                if (possibleData[ac]) {
                    Object.keys(possibleData[ac]).forEach(dest => {
                        possibleData[ac][dest].forEach(flt => {
                            const depMins = toMins(flt.dep_utc);
                            
                            // FIRST LEG logic: Time windows (0500-1000 or 1300-1700 local)
                            if (i === 0) {
                                const depLocal = toMins(flt.dep_local);
                                if ((depLocal >= 300 && depLocal <= 600) || (depLocal >= 780 && depLocal <= 1020)) {
                                    legPool.push({ ...flt, dep: currentCity, arr: dest, equip: ac });
                                }
                            } 
                            // SUBSEQUENT LEGS logic: 15min to 90min turnaround
                            else {
                                const turnaround = depMins - currentTimeMins;
                                if (turnaround >= 15 && turnaround <= 90) {
                                    legPool.push({ ...flt, dep: currentCity, arr: dest, equip: ac });
                                }
                            }
                        });
                    });
                }
            });

            if (legPool.length === 0) break;

            // Pick a random flight from the valid options
            const chosen = legPool[Math.floor(Math.random() * legPool.length)];
            
            // Logic for the Notes (Equipment Change)
            let note = "-";
            if (i > 0) {
                const turnTime = toMins(chosen.dep_utc) - currentTimeMins;
                if (turnTime < 45) {
                    note = "Equipment change";
                }
            }

            roster.push({ ...chosen, note: note });

            // Update state for next iteration
            currentCity = chosen.arr;
            currentTimeMins = toMins(chosen.arr_utc);
        }

        renderTable(roster);
        document.getElementById('startPage').style.display = 'none';
        document.getElementById('flightSchedule').style.display = 'block';

    } catch (err) {
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