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

    // 3. Construct AI Prompt
    const prompto = `Act as a flight dispatcher. Generate a ${legs} leg flight trip for an ${aircraft} starting at ${startICAO}. 
    Return ONLY a raw JSON array of objects with keys: "dep", "arr", "route". No conversation.`;

    const prompt = `Act as a crew scheduler for ${airlineCode}. 
    Generate a realistic ${dutyLength}-day "trip pairing" (roster) for a ${equipmentCode} pilot. 
    Constraints for realism:
    1. Fleet: Only use routes operated by ${airlineCode} on the ${equipmentCode} family fleet
    2. Home base: Start and end the trip at the nominated home base - ${homeBase}
    3: Legality: Maximum 12 hours of duty time per day (duty time starts 30min before first flight), minimum 10 hours of rest (overnight) between duty days
    4: Route logic: Use real ${airlineCode} flight numbers. Ensure the aircraft "flows" logically—if a pilot lands in LAX on Leg 1, Leg 2 must depart from LAX. No deadheading and no long layovers.
    5: Destinations - the flights must be airport pairings that ${airlineCode} actually flies the ${equipmentCode} on, and in the last 12-months.
    6: Preferred airports to fly to (if specified): ${desiredAirports || "None specified"}
    7: Avoid the following airport (if specified): ${excludedAirports || "None specified"}
    8: Use real gates that ${airlineCode} uses at each departure and arrival airport
    
    Return ONLY a raw JSON array of objects with keys: "fltNum","depAirport", "arrAirport", "depTimeLocal", "depTimeUTC", "arrTimeLocal", "arrTimeUTC", "depGate", "arrGate",. 
    No conversation.`


    try {
        // 4. Call Puter.js AI
        const response = await puter.ai.chat(prompt);
        
        // Clean and Parse Data
        // Puter sometimes wraps JSON in ```json blocks, we strip those if they exist
        const cleanJSON = response.replaceAll('```json', '').replaceAll('```', '').trim();
        const flightData = JSON.parse(cleanJSON);

        // 5. Save and Render
        localStorage.setItem('currentTrip', JSON.stringify(flightData));
        renderTable(flightData);

        // 6. Switch Screens
        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('table-screen').style.display = 'block';

    } catch (error) {
        console.error("AI Generation failed:", error);
        alert("Flight planning failed. Please try again.");
    } finally {
        // 7. Hide Spinner regardless of success/fail
        document.getElementById('loader-overlay').style.display = 'none';
    }
}

function renderTable(data) {
    const tbody = document.getElementById('tripBody');
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