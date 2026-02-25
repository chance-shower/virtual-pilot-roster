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
    const maxDayAttempts = (haulPref === 'medium') ? 100 : 20;

    while (attempts < maxDayAttempts) {
        let legs = [];
        let city = startCity;
        let arrivalTime = 0;
        let dutyStart = null;

        for (let i = 0; i < 6; i++) {
            const possibleData = flightData[city]?.[airline];
            if (!possibleData) break;

            let pool = [];
            equipment.forEach(ac => {
                if (possibleData[ac]) {
                    Object.keys(possibleData[ac]).forEach(dest => {
                        // Final day priority: if home is available, only consider home
                        if (isFinalDay && i >= 1 && dest !== homeBase && Object.keys(possibleData[ac]).includes(homeBase)) return;

                        possibleData[ac][dest].forEach(flt => {
                            // 1. Airport filters
                            if (desired.length > 0 && dest !== homeBase && !desired.includes(dest)) return;
                            if (excluded.includes(dest)) return;

                            // 2. Duration Logic
                            const rawDep = toMins(flt.dep_utc);
                            const rawArr = toMins(flt.arr_utc);
                            let duration = rawArr - rawDep;
                            if (duration < 0) duration += 1440; 

                            // Mixed (no preference) skips these checks entirely
                            if (haulPref === 'short' && duration > 180) return; 
                            if (haulPref === 'medium' && duration <= 180) return;

                            // 3. Time Syncing Logic
                            let depM = rawDep;
                            // If this isn't the first flight, and dep is "earlier" than arrival, it's the next day
                            if (i > 0 && depM < (arrivalTime % 1440)) depM += 1440;
                            
                            let absArr = rawArr < rawDep ? rawArr + 1440 : rawArr;
                            if (depM >= 1440 && (rawArr >= rawDep)) absArr += 1440;
                            if (depM >= 1440 && (rawArr < rawDep)) absArr += 0; // Already added 1440

                            // 4. Mode-Based Flexibility
                            if (i === 0) {
                                const local = toMins(flt.dep_local);
                                // MEDIUM REMOVES RESTRICTIONS: If medium, allow any time. If not, stick to windows.
                                const isInsideWindow = (local >= 300 && local <= 600) || (local >= 780 && local <= 1020);
                                
                                if (haulPref === 'medium' || isInsideWindow) {
                                    pool.push({ ...flt, dep: city, arr: dest, equip: ac, absArr, absDep: depM });
                                }
                            } else {
                                const turn = depM - arrivalTime;
                                const duty = (absArr + 15) - dutyStart;
                                const maxTurn = (haulPref === 'medium') ? 300 : 180;
                                
                                if (turn >= 15 && turn <= maxTurn && duty <= 840) {
                                    pool.push({ ...flt, dep: city, arr: dest, equip: ac, absArr, absDep: depM });
                                }
                            }
                        });
                    });
                }
            });

            if (pool.length === 0) break;

            let chosen = isFinalDay && i >= 1 && pool.find(f => f.arr === homeBase) || pool[Math.floor(Math.random() * pool.length)];
            if (i === 0) dutyStart = chosen.absDep - 30;
            
            let note = "-";
            if (legs.length > 0 && chosen.equip !== legs[legs.length - 1].equip) note = "Equipment change";
            if (isFinalDay && chosen.arr === homeBase) note = "End of trip";

            legs.push({ ...chosen, day: dayNum, note });
            city = chosen.arr;
            arrivalTime = chosen.absArr;

            if (isFinalDay && city === homeBase && legs.length >= 2) return legs;
        }

        // Return if we have a valid day (3+ legs or 2+ legs if finishing at base)
        if (legs.length >= 3 || (isFinalDay && legs.length >= 2 && legs[legs.length-1].arr === homeBase)) {
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