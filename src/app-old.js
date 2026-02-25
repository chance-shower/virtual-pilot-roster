document.getElementById('loader-overlay').style.display = 'flex';

    try {
        let fullRoster = [];
        let currentCity = homeBase;

        for (let day = 1; day <= dutyLength; day++) {
            // We use a helper function to "attempt" a full day
            //let dayLegs = generateDay(day, currentCity, (day === dutyLength), airline, equipment, homeBase);
            let dayLegs = generateDay(day, currentCity, (day === dutyLength), airline, equipment, homeBase, desired, excluded);

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