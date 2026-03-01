let flightData = null;

// Convert HH:mm to total minutes
const toMins = (timeStr) => {
    const [h,m] = timeStr.split(':').map(Number);
    return h * 60 + m;
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

            for (let day = 1; day <= dutyLength; day++) {
                let dayLegs = generateDay(day, currentCity, (day === dutyLength), airline, equipment, homeBase, desired, excluded, haulPref);
                if (!dayLegs || dayLegs.length === 0) throw `Failed on day ${day}`; 
                fullRoster = fullRoster.concat(dayLegs);
                currentCity = dayLegs[dayLegs.length - 1].arr;
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
function generateDay(dayNum, startCity, isFinalDay, airline, equipment, homeBase, desired, excluded, haulPref) {
    let attempts = 0;
    const maxDayAttempts = (haulPref === 'short') ? 20 : 150;

    while (attempts < maxDayAttempts) {
        let legs = [];
        let city = startCity;
        let arrivalTime = 0;
        let dutyStart = null;
        let lastFlightDuration = 0;

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

                            // 1. HAUL FILTERS
                            if (haulPref === 'short' && duration > 180) return; 
                            if (haulPref === 'medium' && duration < 45) return; 
                            if (haulPref === 'long' && duration < 60) return; 

                            // 2. TIME & REST LOGIC
                            let depM = rawDep;
                            if (i > 0) {
                                let requiredMinRest = 15; 
                                if (lastFlightDuration > 300) {
                                    requiredMinRest = Math.floor(lastFlightDuration / 2);
                                }
                                while (depM < (arrivalTime + requiredMinRest)) {
                                    depM += 1440;
                                }
                            }
                            
                            let absArr = depM + duration;
                            let currentDutyStart = dutyStart || (depM - 30);
                            const turn = i > 0 ? (depM - arrivalTime) : 0;
                            const duty = (absArr + 15) - currentDutyStart;

                            // 3. START TIME RESTRICTIONS
                            if (i === 0) {
                                const local = toMins(flt.dep_local);
                                // ONLY Short haul is restricted to specific morning/afternoon blocks
                                const isInsideWindow = (local >= 300 && local <= 600) || (local >= 780 && local <= 1020);
                                
                                if (haulPref !== 'short' || isInsideWindow) {
                                    let priority = 1;
                                    if (haulPref === 'medium' && (duration > 180 && duration < 480)) priority = 2;
                                    if (haulPref === 'long' && duration > 480) priority = 3;
                                    if (haulPref === 'long' && (duration > 180 && duration <= 480)) priority = 2;

                                    pool.push({ ...flt, dep: city, arr: dest, equip: ac, absArr, absDep: depM, priority, duration });
                                }
                            } else {
                                // CONNECTION LOGIC
                                const maxDuty = (haulPref === 'long') ? 1080 : 840;
                                const maxTurn = (haulPref === 'short') ? 180 : 600; // 10 hour max turn for long haul

                                if (turn >= 15 && turn <= maxTurn && duty <= maxDuty) {
                                    let priority = 1;
                                    if (haulPref === 'medium' && (duration > 180 && duration < 480)) priority = 2;
                                    if (haulPref === 'long' && duration > 480) priority = 3;
                                    if (haulPref === 'long' && (duration > 180 && duration <= 480)) priority = 2;

                                    pool.push({ ...flt, dep: city, arr: dest, equip: ac, absArr, absDep: depM, priority, duration });
                                }
                            }
                        });
                    });
                }
            });

            if (pool.length === 0) break;

            // SMART PICKER
            let chosen = null;
            if (isFinalDay && i >= 1) chosen = pool.find(f => f.arr === homeBase);

            if (!chosen) {
                const p3 = pool.filter(f => f.priority === 3);
                const p2 = pool.filter(f => f.priority === 2);
                if (p3.length > 0) chosen = p3[Math.floor(Math.random() * p3.length)];
                else if (p2.length > 0) chosen = p2[Math.floor(Math.random() * p2.length)];
                else {
                    chosen = pool[Math.floor(Math.random() * pool.length)];
                    chosen.isFallback = true;
                }
            }

            if (i === 0) dutyStart = chosen.absDep - 30;
            
            let note = "-";
            if (chosen.isFallback && haulPref !== 'short') note = "Duration Fallback";
            if (chosen.duration > 300 && i > 0) note = "Crew Rest Applied";
            if (isFinalDay && chosen.arr === homeBase) note = "End of trip";

            legs.push({ ...chosen, day: dayNum, note });
            city = chosen.arr;
            arrivalTime = chosen.absArr;
            lastFlightDuration = chosen.duration;

            if (isFinalDay && city === homeBase) return legs;
            // Stop adding legs if we are deep into a long haul duty day
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
            <td>${leg.dep_local}</td>
            <td>${leg.dep_utc}</td>
            <td>${leg.arr_local}</td>
            <td>${leg.arr_utc}</td>
            <td>${formatDuration(durationMins)}</td> <td contenteditable="true" inputmode="numeric" data-field="atd" class="editable-cell">${leg.atd || ''}</td>
            <td contenteditable="true" inputmode="numeric" data-field="ata" class="editable-cell">${leg.ata || ''}</td>
            <td>${leg.note}</td>
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

    document.getElementById('preamble').innerHTML = `Here is your ${tripDays} day trip, based at ${homeBase}, flying the ${equipment}<br><br>`;
}

/* Event listeners */ 
document.getElementById('generateFlightRoster').addEventListener('click', createTrip);

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

document.getElementById('closethisflighttrip').addEventListener('click', function() {
    showModal(
        "EXIT TO MENU?", 
        "Return to the start page? (Your roster is safe!)", 
        "GO TO MENU", 
        "STAY HERE", 
        function() {
            // Only hide/show, don't clear storage!
            document.getElementById('flightSchedule').style.display = 'none';
            document.getElementById('startPage').style.display = 'block';
        }
    );
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
    updateBriefcaseDropdown(); // Ensure list is populated on load
    const savedData = localStorage.getItem('savedRoster');
    
    if (savedData) {
        showModal(
            "PREVIOUS TRIP", 
            "A previous flight trip was found. Do you want to continue?",
            "RESUME", 
            "NEW TRIP",
            function() {
                // Restore inputs
                document.getElementById('airlineCode').value = localStorage.getItem('savedAirline') || "";
                document.getElementById('homeBase').value = localStorage.getItem('savedHomeBase') || "";
                document.getElementById('dutyLength').value = localStorage.getItem('savedDutyLength') || "";
                document.getElementById('equipmentCode').value = localStorage.getItem('savedEquipment') || "";

                document.getElementById('startPage').style.display = 'none';
                document.getElementById('flightSchedule').style.display = 'block';

                const legs = JSON.parse(savedData);
                renderTable(legs);
            },
            function() {
                // FIXED: Only clear session keys, NOT the briefcase
                const sessionKeys = ['savedRoster', 'savedAirline', 'savedHomeBase', 'savedDutyLength', 'savedEquipment'];
                sessionKeys.forEach(key => localStorage.removeItem(key));
            }
        );
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