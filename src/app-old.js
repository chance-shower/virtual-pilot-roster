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
        