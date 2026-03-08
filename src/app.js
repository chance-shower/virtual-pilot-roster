let flightData = null;
let airlineMap = {};

// Convert HH:mm to total minutes
const toMins = (timeStr) => {
    if (!timeStr) return 0;
    let h, m;
    if (timeStr.includes(':')) {
        [h, m] = timeStr.split(':').map(Number);
    } else {
        // Handles "0730" format
        h = parseInt(timeStr.substring(0, 2));
        m = parseInt(timeStr.substring(2, 4));
    }
    return (h * 60) + m;
};



// Calculate duration

const formatDuration = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m`;
};

// Function and call to load data

async function loadFlightData() {
    try {
        // Load flight schedules
        const response = await fetch('data/flight_schedules_202212.json');
        if (!response.ok) throw new Error("Issue reading data (1)");
        flightData = await response.json();

        // Load airline logos
        const mapResponse = await fetch('data/airline_map.json'); 
        if (mapResponse.ok) {
            // CRITICAL FIX: Add 'await' here so the map actually populates before use
            airlineMap = await mapResponse.json(); 
            console.log("Airline mapping loaded successfully");
        }

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
    const dutyLength = parseInt(document.getElementById('dutyLength').value) || 4;
    const desired = document.getElementById('desiredAirports').value.split(',').map(s => s.trim().toUpperCase()).filter(s => s !== "");
    const excluded = document.getElementById('excludedAirports').value.split(',').map(s => s.trim().toUpperCase()).filter(s => s !== "");

    document.getElementById('loader-overlay').style.display = 'flex';
    const haulPref = document.querySelector('input[name="haulPreference"]:checked').value;

    let success = false;
    let maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            let fullRoster = [];
            let currentCity = homeBase;
            let tripHistory = []; // Track EVERY route in the trip

            for (let day = 1; day <= dutyLength; day++) {
                // Pass tripHistory into the function
                let dayLegs = generateDay(day, currentCity, (day === dutyLength), airline, equipment, homeBase, desired, excluded, haulPref, tripHistory);
                
                if (!dayLegs || dayLegs.length === 0) throw `Failed on day ${day}`; 
                
                fullRoster = fullRoster.concat(dayLegs);
                currentCity = dayLegs[dayLegs.length - 1].arr;

                // Update the trip history with the legs from this day
                dayLegs.forEach(leg => tripHistory.push(`${leg.dep}-${leg.arr}`));
            }

            // --- TRIP SUCCESSFUL: UPDATE ACTIVE SESSION & UI ---
            renderTable(fullRoster);
            
            // Save settings for the active session (Draft mode)
            localStorage.setItem('savedHomeBase', homeBase);
            localStorage.setItem('savedDutyLength', dutyLength);
            localStorage.setItem('savedEquipment', equipment.join(', '));
            localStorage.setItem('savedAirline', airline);
            localStorage.setItem('savedRoster', JSON.stringify(fullRoster));

            // Reset the dropdown so we know this is a "Draft"
            document.getElementById('tripSelect').value = ""; 

            // Switch to the schedule view
            document.getElementById('startPage').style.display = 'none';
            document.getElementById('flightSchedule').style.display = 'block';
            
            success = true;
            break; 

        } catch (err) {
            console.warn(`Attempt ${attempt} failed: ${err}`);
            if (attempt === maxAttempts) {
                alert("We couldn't find a valid flight path after 10 tries.");
            }
        }
    }

    document.getElementById('loader-overlay').style.display = 'none';
}

// A dedicated function to try and build a 2-6 leg day
function generateDay(dayNum, startCity, isFinalDay, airline, equipment, homeBase, desired, excluded, haulPref, tripHistory) {
    let attempts = 0;
    const maxDayAttempts = (haulPref === 'short') ? 20 : 150;

    while (attempts < maxDayAttempts) {
        let legs = [];
        let city = startCity;
        let arrivalTime = 0;
        let dutyStart = null;
        let lastFlightDuration = 0;
        let localDayHistory = [];

        for (let i = 0; i < 6; i++) {
            const possibleData = flightData[city]?.[airline];
            if (!possibleData) break;

            let pool = [];
            equipment.forEach(ac => {
                if (possibleData[ac]) {
                    Object.keys(possibleData[ac]).forEach(dest => {
                        if (isFinalDay && i >= 1 && dest !== homeBase && Object.keys(possibleData[ac]).includes(homeBase)) return;

                        possibleData[ac][dest].forEach(flt => {
                            if (desired.length > 0 && dest !== homeBase && !desired.includes(dest)) return;
                            if (excluded.includes(dest)) return;

                            const rawDep = toMins(flt.dep_utc);
                            const rawArr = toMins(flt.arr_utc);
                            let duration = (rawArr - rawDep + 1440) % 1440; 

                            if (haulPref === 'short' && duration > 180) return; 
                            if (haulPref === 'medium' && duration < 45) return; 
                            if (haulPref === 'long' && duration < 60) return; 

                            let depM = rawDep;
                            if (i > 0) {
                                let requiredMinRest = 15; 
                                if (lastFlightDuration > 300) requiredMinRest = Math.floor(lastFlightDuration / 2);
                                
                                // Adjust depM to be after previous arrival
                                while (depM < (arrivalTime + requiredMinRest)) depM += 1440;
                            }
                            
                            // --- NEW: MIDNIGHT GUARD ---
                            // For Short/Medium, scheduled departure must be before midnight of the duty day
                            if (haulPref !== 'long' && depM >= 1440) return;

                            let absArr = depM + duration;
                            let currentDutyStart = dutyStart || (depM - 30);
                            const turn = i > 0 ? (depM - arrivalTime) : 0;
                            const duty = (absArr + 15) - currentDutyStart;

                            const maxDuty = (haulPref === 'long') ? 1080 : 840;
                            
                            // --- NEW: LAYOVER EFFICIENCY ---
                            let maxTurn = (haulPref === 'short') ? 120 : 600;
                            if (haulPref === 'medium') maxTurn = 120; // Cap medium haul layovers at 2h

                            const isFirstLegValid = (i === 0 && (haulPref !== 'short' || ((toMins(flt.dep_local) >= 300 && toMins(flt.dep_local) <= 600) || (toMins(flt.dep_local) >= 780 && toMins(flt.dep_local) <= 1020))));
                            const isSubsequentValid = (i > 0 && turn >= 15 && turn <= maxTurn && duty <= maxDuty);

                            if (isFirstLegValid || isSubsequentValid) {
                                let priority = 1;
                                const routeKey = `${city}-${dest}`;
                                const isRepeat = tripHistory.includes(routeKey) || localDayHistory.includes(routeKey);

                                if (isRepeat) {
                                    priority = 0;
                                } else {
                                    if (i > 0 && turn >= 15 && turn <= 75) priority = 4;
                                    else if (haulPref === 'medium' && (duration > 180 && duration < 480)) priority = 2;
                                    else if (haulPref === 'long' && duration > 480) priority = 3;
                                }

                                pool.push({ ...flt, dep: city, arr: dest, equip: ac, absArr, absDep: depM, priority, duration });
                            }
                        });
                    });
                }
            });

            if (pool.length === 0) break;

            let chosen = null;
            if (isFinalDay && i >= 1) chosen = pool.find(f => f.arr === homeBase);

            if (!chosen) {
                const priorities = [4, 3, 2, 1, 0];
                for (let p of priorities) {
                    const subPool = pool.filter(f => f.priority === p);
                    if (subPool.length > 0) {
                        chosen = subPool[Math.floor(Math.random() * subPool.length)];
                        break;
                    }
                }
            }

            if (i === 0) dutyStart = chosen.absDep - 30;
            localDayHistory.push(`${chosen.dep}-${chosen.arr}`);

            let note = chosen.priority === 0 ? "Repeat Route" : "-";
            if (chosen.duration > 300 && i > 0) note = "Crew Rest Applied";
            if (isFinalDay && chosen.arr === homeBase) note = "End of trip";

            legs.push({ ...chosen, day: dayNum, note });
            city = chosen.arr;
            arrivalTime = chosen.absArr;
            lastFlightDuration = chosen.duration;

            if (isFinalDay && city === homeBase) return legs;
            if (dutyStart && (arrivalTime - dutyStart) > 900) break; 
        }

        const minLegs = (haulPref === 'long') ? 1 : 2;
        if (legs.length >= minLegs || (isFinalDay && legs.length >= 1 && legs[legs.length-1].arr === homeBase)) {
            return legs;
        }
        attempts++;
    }
    return null;
}

// Render first leg into table

function renderTable(legs) {
    const tbody = document.getElementById('rosterTableBody');
    tbody.innerHTML = ""; 

    const airlineCode = document.getElementById('airlineCode').value.toUpperCase();

    legs.forEach((leg, index) => {
        const row = document.createElement('tr');
        
        if (index > 0) {
            const prevLeg = legs[index - 1];
            
            // 1. End of Day: Apply thick red border to the PREVIOUS row's bottom
            if (leg.day !== prevLeg.day) {
                const allRows = tbody.querySelectorAll('tr');
                const lastRow = allRows[allRows.length - 1];
                if (lastRow) lastRow.classList.add('day-break-row');
            } 
            
            // 2. Equipment Change: Apply dashed border to CURRENT row's top
            // Note: We only do this if it's the SAME day to avoid clashing with day breaks
            else if (leg.equip !== prevLeg.equip) {
                row.classList.add('equip-change-row');
            }
        }

        // Calculate duration for this leg
        const depM = toMins(leg.dep_utc);
        const arrM = toMins(leg.arr_utc);
        let durationMins = arrM - depM;
        if (durationMins < 0) durationMins += 1440; // Handle midnight crossing
    
        if (index > 0 && leg.equip !== legs[index - 1].equip) {
            row.style.borderTop = "3px solid #e74c3c";
        }
    
        const simBriefUrl = `https://www.simbrief.com/system/dispatch.php?type=briefing&airline=${airlineCode}&flightnum=${leg.callsign}&orig=${leg.dep}&dest=${leg.arr}&type=${leg.equip}`;
    
        row.innerHTML = `
            <td>${leg.day}</td>
            <td>${airlineCode}</td>
            <td><a href="${simBriefUrl}" target="_blank" class="simbrief-link">${leg.callsign}</a></td>
            <td contenteditable="true" data-field="equip" class="editable-cell">${leg.equip}</td>
            <td>${leg.dep}</td>
            <td>${leg.arr}</td>
            <td contenteditable="true" data-field="depGate" class="editable-cell">${leg.depGate || ''}</td>
            <td contenteditable="true" data-field="arrGate" class="editable-cell">${leg.arrGate || ''}</td>
            <td contenteditable="true">${leg.dep_local}</td>
            <td contenteditable="true">${leg.dep_utc}</td>
            <td contenteditable="true">${leg.arr_local}</td>
            <td contenteditable="true">${leg.arr_utc}</td>
            <td contenteditable="true">${formatDuration(durationMins)}</td> <td contenteditable="true" inputmode="numeric" data-field="atd" class="editable-cell">${leg.atd || ''}</td>
            <td contenteditable="true" inputmode="numeric" data-field="ata" class="editable-cell">${leg.ata || ''}</td>
            <td contenteditable="true">${leg.note}</td>
        `;
        tbody.appendChild(row);
    });

    // Global Save
    localStorage.setItem('savedRoster', JSON.stringify(legs));
    localStorage.setItem('savedAirline', airlineCode);

    // Get values for the preamble
    const tripDays = document.getElementById('dutyLength').value || "?";
    const homeBase = (document.getElementById('homeBase').value || "BASE").toUpperCase().trim();
    const equipment = document.getElementById('equipmentCode').value || "ACFT";

    // SAVE these so window.onload can find them later
    localStorage.setItem('savedHomeBase', homeBase);
    localStorage.setItem('savedDutyLength', tripDays);
    localStorage.setItem('savedEquipment', equipment);

    // Update preamble data
    document.getElementById('display-equipment').innerHTML = `${equipment}`;
    document.getElementById('display-base').innerHTML = `${homeBase}`;
    document.getElementById('display-length').innerHTML = `${tripDays}`;

    const currentICAO = document.getElementById('airlineCode').value.toUpperCase();
    updateAirlineLogo(currentICAO);
}

/* Event listeners */ 
document.getElementById('generateFlightRoster').addEventListener('click', createTrip);

document.getElementById('openBriefcaseBtn').addEventListener('click', () => {
    const briefcase = JSON.parse(localStorage.getItem('tripBriefcase') || "[]");
    
    if (briefcase.length === 0) {
        alert("Your briefcase is empty. Generate or Import a trip first!");
        return;
    }

    // Switch views to reveal the briefcase area
    document.getElementById('startPage').style.display = 'none';
    document.getElementById('flightSchedule').style.display = 'block';
    
    // Smoothly focus the dropdown for the user
    document.getElementById('tripSelect').focus();
});

// 2. Sidebar Manual Entry: Connects the new button to your existing manualEntry logic
document.getElementById('sidebarManualEntry').addEventListener('click', () => {
    // This triggers your existing 'manualEntry' click event
    document.getElementById('manualEntry').click();
});

// Saving edited fields
document.getElementById('rosterTable').addEventListener('input', (e) => {
    if (e.target.classList.contains('editable-cell')) {
        const cell = e.target;
        const field = cell.getAttribute('data-field');
        const rowIndex = cell.closest('tr').sectionRowIndex;

        let savedData = localStorage.getItem('savedRoster');
        if (savedData) {
            let legs = JSON.parse(savedData);
            if (legs[rowIndex]) {
                // 1. Update Active Session
                legs[rowIndex][field] = cell.innerText;
                localStorage.setItem('savedRoster', JSON.stringify(legs));

                // 2. LIVE-SAVE TO BRIEFCASE (if a trip is currently selected)
                const currentTripId = document.getElementById('tripSelect').value;
                if (currentTripId) {
                    let briefcase = JSON.parse(localStorage.getItem('tripBriefcase') || "[]");
                    const tripIndex = briefcase.findIndex(t => t.id == currentTripId);
                    if (tripIndex !== -1) {
                        briefcase[tripIndex].data = legs;
                        localStorage.setItem('tripBriefcase', JSON.stringify(briefcase));
                        console.log("Briefcase synced");
                    }
                }
            }
        }
    }
});

// Manual entry function

// 1. The Open Trigger
const handleManualEntryClick = function() {
    const overlay = document.getElementById('manualEntryOverlay');
    const textArea = document.getElementById('csvTextArea');
    
    // Clear previous input and show modal
    textArea.value = ""; 
    overlay.classList.remove('modal-hidden');
};

// 2. Attach to both buttons
document.getElementById('manualEntry').addEventListener('click', handleManualEntryClick);
document.getElementById('sidebarManualEntry').addEventListener('click', handleManualEntryClick);

// 3. The Cancel Logic
document.getElementById('manualCancel').onclick = function() {
    document.getElementById('manualEntryOverlay').classList.add('modal-hidden');
};

// 4. The Import Logic (Your Original Code, adapted for the Modal)
document.getElementById('manualConfirm').onclick = function() {
    const csvInput = document.getElementById('csvTextArea').value;
    const overlay = document.getElementById('manualEntryOverlay');

    if (!csvInput) {
        overlay.classList.add('modal-hidden');
        return;
    }

    try {
        let cleanedInput = csvInput.trim();
        let lines = cleanedInput.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length === 1) {
            cleanedInput = cleanedInput.replace(/Departing,arriving/i, "\nDeparting,arriving");
            cleanedInput = cleanedInput.replace(/(?!\bAirline\b)([A-Z]{4},[A-Z]{4},)/g, "\n$1");
            lines = cleanedInput.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
        }

        if (lines.length < 3) throw new Error("Input format error.");

        const metaParts = lines[0].split(',').map(s => s.trim());
        const airline = (metaParts[1] || "FLT").toUpperCase();
        const equip = (metaParts[3] || "ACFT").toUpperCase();
        const base = (metaParts[5] || "BASE").toUpperCase();

        const manualLegs = [];
        const formatTime = (t) => t.includes(':') ? t : `${t.substring(0, 2)}:${t.substring(2, 4)}`;

        for (let i = 2; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            if (cols.length >= 6 && cols[0].length >= 3) {
                const depICAO = cols[0].toUpperCase();
                const arrICAO = cols[1].toUpperCase();
                const depUTC = formatTime(cols[3]); 
                const arrUTC = formatTime(cols[4]);

                const getLocalTime = (icao, utcTime) => {
                    const airportEntry = flightData[icao];
                    if (!airportEntry) return utcTime; 
                    try {
                        const firstCarrier = Object.values(airportEntry)[0];
                        const firstType = Object.values(firstCarrier)[0];
                        const firstDest = Object.values(firstType)[0];
                        const sample = firstDest[0];
                        const sUTC = toMins(sample.dep_utc);
                        const sLoc = toMins(sample.dep_local);
                        let offset = sLoc - sUTC;
                        if (offset > 720) offset -= 1440;
                        if (offset < -720) offset += 1440;
                        let totalMins = (toMins(utcTime) + offset + 1440) % 1440;
                        const h = Math.floor(totalMins / 60);
                        const m = totalMins % 60;
                        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                    } catch (e) { return utcTime; }
                };

                manualLegs.push({
                    day: parseInt(cols[5]) || 1,
                    dep: depICAO,
                    arr: arrICAO,
                    callsign: cols[2].toUpperCase(),
                    dep_utc: depUTC, 
                    arr_utc: arrUTC, 
                    dep_local: getLocalTime(depICAO, depUTC),
                    arr_local: getLocalTime(arrICAO, arrUTC),
                    equip: equip,
                    note: "-"
                });
            }
        }

        if (manualLegs.length === 0) throw new Error("Could not find flight data rows.");

        // UI Updates
        document.getElementById('airlineCode').value = airline;
        document.getElementById('homeBase').value = base;
        document.getElementById('equipmentCode').value = equip;
        
        localStorage.setItem('savedRoster', JSON.stringify(manualLegs));
        localStorage.setItem('savedAirline', airline);
        localStorage.setItem('savedHomeBase', base);
        localStorage.setItem('savedEquipment', equip);
        localStorage.setItem('savedDutyLength', manualLegs[manualLegs.length - 1].day);

        renderTable(manualLegs);

        // --- THE FIX STARTS HERE ---
        // 1. Hide the Start Page by adding the utility class (preserves CSS logic)
        document.getElementById('startPage').classList.add('modal-hidden');
        
        // 2. Show the Flight Schedule
        document.getElementById('flightSchedule').style.display = 'block';

        // 3. Hide the Manual Entry Overlay using the utility class
        overlay.classList.add('modal-hidden');
        // --- THE FIX ENDS HERE ---

        alert(`Imported ${manualLegs.length} legs!`);

    } catch (err) {
        alert("Parsing Error: " + err.message);
    }
};

// end of manual entry


document.getElementById('closethisflighttrip').addEventListener('click', function() {
    showModal("Exit to menu?", "Return to the start page?", "Exit", "Cancel", function() {
        document.getElementById('flightSchedule').style.display = 'none';
        // Remove the hidden class to show the start page again
        document.getElementById('startPage').classList.remove('modal-hidden');
        window.scrollTo(0, 0);
    });
});

document.addEventListener('focusin', (e) => {
    if (e.target.classList.contains('editable-cell')) {
        // Short delay ensures the keyboard doesn't interfere with selection
        setTimeout(() => {
            const range = document.createRange();
            range.selectNodeContents(e.target);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }, 50);
    }
});

// Re-roll button logic
document.getElementById('rerunButton').addEventListener('click', () => {
    // Scroll to top so user sees the loader
    window.scrollTo(0, 0);
    // Simply trigger the main generation function again
    createTrip();
});

function updateAirlineLogo(icao) {
    const logoImg = document.getElementById('airline-logo');
    if (!logoImg) return;

    const airlineEntry = airlineMap[icao.toUpperCase()];

    if (airlineEntry && airlineEntry.iata) {
        const iata = airlineEntry.iata;
        logoImg.src = `https://assets.duffel.com/img/airlines/for-light-background/full-color-logo/${iata}.svg`;
        logoImg.style.display = 'block';

        // Hide if Duffel returns a 404 (logo missing on their end)
        logoImg.onerror = function() {
            this.style.display = 'none';
        };
    } else {
        // Hide if no ICAO found or no IATA code available
        logoImg.style.display = 'none';
        logoImg.src = ""; 
    }
}

/* Startup functions */

function showModal(title, message, confirmText, cancelText, onConfirm, onCancel) {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalMessage').innerText = message;
    
    // Update button labels
    const confirmBtn = document.getElementById('modalConfirm');
    const cancelBtn = document.getElementById('modalCancel');
    confirmBtn.innerText = confirmText;
    cancelBtn.innerText = cancelText;
    
    overlay.classList.remove('modal-hidden');

    confirmBtn.onclick = function() {
        overlay.classList.add('modal-hidden');
        if (onConfirm) onConfirm();
    };

    cancelBtn.onclick = function() {
        overlay.classList.add('modal-hidden');
        if (onCancel) onCancel();
    };
}

window.onload = function() {
    // 1. Always keep the briefcase dropdown up to date
    updateBriefcaseDropdown(); 
    
    // 2. Silently check for a "Draft" (active session) 
    // We don't show a modal, but we'll keep the data in storage 
    // until the user either hits 'Generate' or 'Open'.
    const savedData = localStorage.getItem('savedRoster');
    
    if (savedData) {
        console.log("Active session data is sitting in standby.");
    }
};

function updateBriefcaseDropdown() {
    const select = document.getElementById('tripSelect');
    const briefcase = JSON.parse(localStorage.getItem('tripBriefcase') || "[]");
    
    // Clear but keep first option
    select.innerHTML = '<option value="">-- List of trips --</option>';
    
    briefcase.forEach(trip => {
        const opt = document.createElement('option');
        opt.value = trip.id;
        opt.innerText = trip.name;
        select.appendChild(opt);
    });
}

function saveToBriefcase() {
    const legs = JSON.parse(localStorage.getItem('savedRoster'));
    if (!legs || legs.length === 0) return;

    // Check if this trip is already in the briefcase
    const currentTripId = document.getElementById('tripSelect').value;
    if (currentTripId) {
        alert("This trip is already in your briefcase and auto-syncing!");
        return;
    }

    const airline = localStorage.getItem('savedAirline') || "FLT";
    const home = localStorage.getItem('savedHomeBase') || "BASE";
    const equip = localStorage.getItem('savedEquipment') || "ACFT";
    const timestamp = new Date().toLocaleDateString('en-GB', {day:'2-digit', month:'short'});
    const tripName = `${airline} | ${home} | ${equip} (${timestamp})`;

    let briefcase = JSON.parse(localStorage.getItem('tripBriefcase') || "[]");
    const newId = Date.now(); // Create the unique ID
    
    const newEntry = {
        id: newId,
        name: tripName,
        data: legs,
        settings: {
            airline, home, equip,
            len: localStorage.getItem('savedDutyLength')
        }
    };

    briefcase.push(newEntry);
    localStorage.setItem('tripBriefcase', JSON.stringify(briefcase));
    updateBriefcaseDropdown();
    
    // LOCK the dropdown to this new trip so live-sync works immediately
    document.getElementById('tripSelect').value = newId; 
    alert("Trip saved to briefcase!");
}

// Event: Loading from Briefcase
document.getElementById('tripSelect').addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;

    const briefcase = JSON.parse(localStorage.getItem('tripBriefcase') || "[]");
    const trip = briefcase.find(t => t.id == id);

    if (trip) {
        // Update inputs and active storage
        document.getElementById('airlineCode').value = trip.settings.airline;
        document.getElementById('homeBase').value = trip.settings.home;
        document.getElementById('equipmentCode').value = trip.settings.equip;
        document.getElementById('dutyLength').value = trip.settings.len;

        localStorage.setItem('savedRoster', JSON.stringify(trip.data));
        renderTable(trip.data);

        updateAirlineLogo(trip.settings.airline);
    }
});

// Event: PDF Export
document.getElementById('exportPDF').addEventListener('click', () => {
    const airline = document.getElementById('airlineCode').value || "PILOT";
    document.title = `Roster_${airline}_${new Date().getTime()}`;
    window.print();
});

// Event: Backup Export (JSON)
document.getElementById('exportBackup').addEventListener('click', () => {
    const briefcase = localStorage.getItem('tripBriefcase') || "[]";
    const blob = new Blob([briefcase], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pilot_roster_trip_backup.json`;
    a.click();
    URL.revokeObjectURL(url);
});

// Event: Import Backup
document.getElementById('importBackup').addEventListener('click', () => {
    document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            if (Array.isArray(imported)) {
                localStorage.setItem('tripBriefcase', JSON.stringify(imported));
                updateBriefcaseDropdown();
                alert("Trip imported successfully!");
            }
        } catch (err) { alert("Error reading backup file."); }
    };
    reader.readAsText(file);
});

// Event: Delete Single Trip
document.getElementById('deleteSelectedTrip').addEventListener('click', () => {
    const id = document.getElementById('tripSelect').value;
    if (!id) return;

    showModal("DELETE SAVED TRIP?", "Remove this from your roster permanently?", "YES", "NO", () => {
        let briefcase = JSON.parse(localStorage.getItem('tripBriefcase') || "[]");
        briefcase = briefcase.filter(t => t.id != id);
        localStorage.setItem('tripBriefcase', JSON.stringify(briefcase));
        updateBriefcaseDropdown();
    });
});

document.getElementById('saveCurrentTrip').addEventListener('click', saveToBriefcase);

// Update your window.onload to include:
window.addEventListener('DOMContentLoaded', updateBriefcaseDropdown);