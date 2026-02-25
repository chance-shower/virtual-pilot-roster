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

    // We wrap the generation in a retry loop
    let success = false;
    let maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            let fullRoster = [];
            let currentCity = homeBase;

            for (let day = 1; day <= dutyLength; day++) {
                let dayLegs = generateDay(day, currentCity, (day === dutyLength), airline, equipment, homeBase, desired, excluded, haulPref);

                if (!dayLegs || dayLegs.length === 0) {
                    // Instead of alert, we throw an error to trigger a retry for the WHOLE trip
                    throw `Failed on day ${day}`; 
                }

                fullRoster = fullRoster.concat(dayLegs);
                currentCity = dayLegs[dayLegs.length - 1].arr;
            }

            // If we reach this point, the entire trip was successful!
            renderTable(fullRoster);
            
            localStorage.setItem('savedHomeBase', homeBase);
            localStorage.setItem('savedDutyLength', dutyLength);
            localStorage.setItem('savedEquipment', equipment.join(', '));

            document.getElementById('startPage').style.display = 'none';
            document.getElementById('flightSchedule').style.display = 'block';
            
            success = true;
            break; // Exit the 10-attempt loop

        } catch (err) {
            console.warn(`Attempt ${attempt} failed: ${err}`);
            // If it's the 10th attempt and we still haven't succeeded:
            if (attempt === maxAttempts) {
                alert("We couldn't find a valid flight path after 10 tries. Try changing your airport restrictions or duty length to give the generator more options.");
            }
            // Otherwise, the loop continues to the next attempt...
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
                // Update the specific field (depGate, atd, etc.)
                legs[rowIndex][field] = cell.innerText;
                localStorage.setItem('savedRoster', JSON.stringify(legs));
            }
        }
    }
});

document.getElementById('closethisflighttrip').addEventListener('click', function() {
    showModal(
        "DELETE TRIP?", 
        "This will permanently remove the current roster. Are you sure?", 
        "YES, DELETE", // Confirm Text
        "KEEP TRIP",   // Cancel Text
        function() {
            localStorage.clear();
            location.reload();
        },
        function() {
            // Do nothing, modal just closes
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
    const savedData = localStorage.getItem('savedRoster');
    
    if (savedData) {
        showModal(
            "PREVIOUS TRIP", 
            "A previous flight roster was found. Do you want to continue?",
            "RESUME", 
            "NEW TRIP",
            function() {
                // Restore inputs
                const airline = localStorage.getItem('savedAirline');
                const homeBase = localStorage.getItem('savedHomeBase');
                const dutyLength = localStorage.getItem('savedDutyLength');
                const equipment = localStorage.getItem('savedEquipment');

                if(airline) document.getElementById('airlineCode').value = airline;
                if(homeBase) document.getElementById('homeBase').value = homeBase;
                if(dutyLength) document.getElementById('dutyLength').value = dutyLength;
                if(equipment) document.getElementById('equipmentCode').value = equipment;

                // --- THE MISSING ACTION LINES ---
                document.getElementById('startPage').style.display = 'none';
                document.getElementById('flightSchedule').style.display = 'block';
                // --------------------------------

                const legs = JSON.parse(savedData);
                renderTable(legs);
            },
            function() {
                localStorage.clear(); 
            }
        );
    }
};