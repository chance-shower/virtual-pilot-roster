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
    const dutyLength = parseInt(document.getElementById('dutyLength').value) || 4;

    document.getElementById('loader-overlay').style.display = 'flex';

    try {
        let fullRoster = [];
        let currentCity = homeBase;

        for (let day = 1; day <= dutyLength; day++) {
            // We use a helper function to "attempt" a full day
            let dayLegs = generateDay(day, currentCity, (day === dutyLength), airline, equipment, homeBase);
            
            if (!dayLegs || dayLegs.length === 0) {
                 throw `Could not find a valid flight path for Day ${day} starting from ${currentCity}.`;
            }

            fullRoster = fullRoster.concat(dayLegs);
            // Update currentCity to the last arrival of the day for the next morning
            currentCity = dayLegs[dayLegs.length - 1].arr;
        }

        renderTable(fullRoster);
        
        localStorage.setItem('savedHomeBase', homeBase);
        localStorage.setItem('savedDutyLength', dutyLength);
        localStorage.setItem('savedEquipment', equipment.join(', '));

        document.getElementById('startPage').style.display = 'none';
        document.getElementById('flightSchedule').style.display = 'block';

    } catch (err) {
        alert(err);
    } finally {
        document.getElementById('loader-overlay').style.display = 'none';
    }
}

// A dedicated function to try and build a 2-6 leg day
function generateDay(dayNum, startCity, isFinalDay, airline, equipment, homeBase) {
    let attempts = 0;
    while (attempts < 20) { // Try 20 different random paths for this day
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
                        // Priority logic for returning home on final day
                        if (isFinalDay && i >= 1 && dest !== homeBase && Object.keys(possibleData[ac]).includes(homeBase)) return;

                        possibleData[ac][dest].forEach(flt => {
                            let depM = toMins(flt.dep_utc);
                            if (i > 0 && depM < (arrivalTime % 1440)) depM += 1440;
                            
                            let absArr = toMins(flt.arr_utc) < toMins(flt.dep_utc) ? toMins(flt.arr_utc) + 1440 : toMins(flt.arr_utc);
                            if (depM >= 1440) absArr += 1440;

                            if (i === 0) {
                                const local = toMins(flt.dep_local);
                                if ((local >= 300 && local <= 600) || (local >= 780 && local <= 1020)) {
                                    pool.push({ ...flt, dep: city, arr: dest, equip: ac, absArr, absDep: depM });
                                }
                            } else {
                                const turn = depM - arrivalTime;
                                const duty = (absArr + 15) - dutyStart;
                                if (turn >= 15 && turn <= 180 && duty <= 840) {
                                    pool.push({ ...flt, dep: city, arr: dest, equip: ac, absArr, absDep: depM });
                                }
                            }
                        });
                    });
                }
            });

            if (pool.length === 0) break;

            // Pick a flight, favoring home on final day
            let chosen = isFinalDay && i >= 1 && pool.find(f => f.arr === homeBase) || pool[Math.floor(Math.random() * pool.length)];
            
            if (i === 0) dutyStart = chosen.absDep - 30;
            
            let note = "-";
            if (i > 0 && (chosen.absDep - arrivalTime) < 45) note = "Equipment change";
            if (isFinalDay && chosen.arr === homeBase) note = "End of trip";

            legs.push({ ...chosen, day: dayNum, note });
            city = chosen.arr;
            arrivalTime = chosen.absArr;

            if (isFinalDay && city === homeBase && legs.length >= 2) return legs;
        }

        // If we got at least 3 legs (or 2 if back at base), consider it a success
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
        
        // Equipment Change Logic: Check if current equip is different from previous leg
        if (index > 0 && leg.equip !== legs[index - 1].equip) {
            row.style.borderTop = "3px solid #e74c3c"; // Visual indicator
        }

        const simBriefUrl = `https://www.simbrief.com/system/dispatch.php?type=briefing&airline=${airlineCode}&flightnum=${leg.callsign}&orig=${leg.dep}&dest=${leg.arr}&type=${leg.equip}`;

        // Note the 'data-field' attributes and the ternary operators ${leg.field || ''} 
        // which ensure that if data was previously saved, it shows up on reload.
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
            <td contenteditable="true" inputmode="numeric" data-field="atd" class="editable-cell">${leg.atd || ''}</td>
            <td contenteditable="true" inputmode="numeric" data-field="ata" class="editable-cell">${leg.ata || ''}</td>
            <td>${leg.note}</td>
        `;
        tbody.appendChild(row);
    });

    // Global Save (Moved outside the loop so it only fires once)
    localStorage.setItem('savedRoster', JSON.stringify(legs));
    localStorage.setItem('savedAirline', airlineCode);

    // Update Preamble
    const tripDays = document.getElementById('dutyLength').value || "?";
    const homeBase = (document.getElementById('homeBase').value || "BASE").toUpperCase().trim();
    const equipment = document.getElementById('equipmentCode').value || "ACFT";

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
        function() {
            // Confirm: Clear and reload
            localStorage.removeItem('savedRoster');
            localStorage.removeItem('savedAirline');
            location.reload();
        },
        function() {
            // Cancel: Do nothing, just closes the modal
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

function showModal(title, message, onConfirm, onCancel) {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalMessage').innerText = message;
    
    overlay.classList.remove('modal-hidden');

    document.getElementById('modalConfirm').onclick = function() {
        overlay.classList.add('modal-hidden');
        if (onConfirm) onConfirm();
    };

    document.getElementById('modalCancel').onclick = function() {
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
            function() {
                // 1. Restore all inputs so renderTable() has data to build the preamble
                const airline = localStorage.getItem('savedAirline');
                const homeBase = localStorage.getItem('savedHomeBase');
                const dutyLength = localStorage.getItem('savedDutyLength');
                const equipment = localStorage.getItem('savedEquipment');

                if(airline) document.getElementById('airlineCode').value = airline;
                if(homeBase) document.getElementById('homeBase').value = homeBase;
                if(dutyLength) document.getElementById('dutyLength').value = dutyLength;
                if(equipment) document.getElementById('equipmentCode').value = equipment;

                // 2. Hide Start Page / Show Schedule
                document.getElementById('startPage').style.display = 'none';
                document.getElementById('flightSchedule').style.display = 'block';
                
                // 3. Render
                const legs = JSON.parse(savedData);
                renderTable(legs);
            },
            function() {
                // User clicked NEW TRIP - Clear everything
                localStorage.clear(); 
            }
        );
    }
};