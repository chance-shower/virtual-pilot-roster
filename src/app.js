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
        alert("Schedules loading...");
        return; 
    }

    const airline = document.getElementById('airlineCode').value.toUpperCase().trim();
    const homeBase = document.getElementById('homeBase').value.toUpperCase().trim();
    const equipment = document.getElementById('equipmentCode').value.split(',').map(s => s.trim().toUpperCase()).filter(s => s !== "");
    const dutyLength = parseInt(document.getElementById('dutyLength').value) || 1;

    document.getElementById('loader-overlay').style.display = 'flex';

    try {
        let fullRoster = [];
        let currentCity = homeBase;

        for (let day = 1; day <= dutyLength; day++) {
            let dayLegs = [];
            let dutyStartMins = null;
            let currentArrivalTimeMins = 0;
            const isFinalDay = (day === dutyLength);

            // Inner Loop: Try to build a valid day (2-6 legs)
            // We use a labeled loop so we can break out of the day easily
            dayLoop: for (let i = 0; i < 6; i++) {
                const possibleData = flightData[currentCity]?.[airline];
                if (!possibleData) break dayLoop;

                let legPool = [];
                equipment.forEach(ac => {
                    if (possibleData[ac]) {
                        Object.keys(possibleData[ac]).forEach(dest => {
                            // On final day, if we have >2 legs, start looking for a way home
                            if (isFinalDay && i >= 1 && dest !== homeBase) {
                                // We prioritize the home base on the final leg
                                if (Object.keys(possibleData[ac]).includes(homeBase)) return; 
                            }

                            possibleData[ac][dest].forEach(flt => {
                                const depMinsRaw = toMins(flt.dep_utc);
                                const arrMinsRaw = toMins(flt.arr_utc);
                                
                                let depMins = depMinsRaw;
                                if (i > 0 && depMins < (currentArrivalTimeMins % 1440)) depMins += 1440;

                                let absArr = arrMinsRaw < depMinsRaw ? arrMinsRaw + 1440 : arrMinsRaw;
                                if (depMins >= 1440) absArr += 1440;

                                if (i === 0) {
                                    const depLocal = toMins(flt.dep_local);
                                    if ((depLocal >= 300 && depLocal <= 600) || (depLocal >= 780 && depLocal <= 1020)) {
                                        legPool.push({ ...flt, dep: currentCity, arr: dest, equip: ac, absArr: absArr, absDep: depMins });
                                    }
                                } else {
                                    const turn = depMins - currentArrivalTimeMins;
                                    const totalDuty = (absArr + 15) - dutyStartMins;
                                    
                                    if (turn >= 15 && turn <= 180 && totalDuty <= 840) {
                                        legPool.push({ ...flt, dep: currentCity, arr: dest, equip: ac, absArr: absArr, absDep: depMins });
                                    }
                                }
                            });
                        });
                    }
                });

                if (legPool.length === 0) break dayLoop;

                // Priority: If it's the final day and we can go home, take it.
                let chosen;
                const homeFlight = legPool.find(f => f.arr === homeBase);
                if (isFinalDay && i >= 1 && homeFlight) {
                    chosen = homeFlight;
                } else {
                    chosen = legPool[Math.floor(Math.random() * legPool.length)];
                }
                
                if (i === 0) dutyStartMins = chosen.absDep - 30;

                let note = "-";
                const turnTime = i > 0 ? (chosen.absDep - currentArrivalTimeMins) : 0;
                if (i > 0 && turnTime < 45) note = "Equipment change";
                if (isFinalDay && chosen.arr === homeBase) note = "End of Tour";

                dayLegs.push({ ...chosen, day: day, note: note });
                currentCity = chosen.arr;
                currentArrivalTimeMins = chosen.absArr;

                // If we returned home on the final day, we are done!
                if (isFinalDay && currentCity === homeBase && dayLegs.length >= 2) break dayLoop;
            }

            if (dayLegs.length < 1) throw `Could not find flights to continue trip on Day ${day} from ${currentCity}`;
            fullRoster = fullRoster.concat(dayLegs);
        }

        renderTable(fullRoster);
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

    legs.forEach((leg) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${leg.day}</td>
            <td>${document.getElementById('airlineCode').value.toUpperCase()}</td>
            <td>${leg.callsign}</td>
            <td>${leg.dep}</td>
            <td>${leg.arr}</td>
            <td>${String.fromCharCode(65 + Math.floor(Math.random() * 5))}${Math.floor(Math.random() * 20 + 1)}</td>
            <td>-</td>
            <td>${leg.dep_local}</td>
            <td>${leg.dep_utc}</td>
            <td>${leg.arr_local}</td>
            <td>${leg.arr_utc}</td>
            <td>-</td>
            <td>-</td>
            <td>${leg.note}</td>
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