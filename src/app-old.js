// AI roster generator

async function createTrip() {
    // 1. Get user input
    const airlineCode = document.getElementById('airlineCode').value;
    const equipmentCode = document.getElementById('equipmentCode').value;
    const homeBase = document.getElementById('homeBase').value;
    const dutyLength = document.getElementById('dutyLength').value;
    const desiredAirports = document.getElementById('desiredAirports')?.value;
    const excludedAirports = document.getElementById('excludedAirports')?.value;

    // 2. Show Loading Spinner
    document.getElementById('loader-overlay').style.display = 'flex';

    // 3. code here to start the process
    
}

function renderTable(data) {
    const tbody = document.getElementById('rosterTableBody');
    tbody.innerHTML = ""; // Clear existing rows

    data.forEach((leg, index) => {
        const row = `
            <tr>
                <td>${index + 1}</td>
                <td contenteditable="true">${leg.dep}</td>
                <td contenteditable="true">${leg.arr}</td>
                <td contenteditable="true">${leg.route}</td>
                <td><button onclick="dispatchToSimBrief('${leg.dep}', '${leg.arr}', '${leg.route}')">Dispatch</button></td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

// SimBrief button
// Will need to link this to all the row buttons

document.getElementById('testbtn').addEventListener('click', () => {
    const departure = "KORD";
    const arrival = "KDEN";
    const equipment = "B738";
    const airline = "UAL";
    const flightNum = "604";

    const simBriefURL = `https://www.simbrief.com/system/dispatch.php?airline=${airline}&fltnum=${flightNum}&orig=${departure}&dest=${arrival}&type=${equipment}`;

    window.open(simBriefURL, '_blank')
});