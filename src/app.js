document.getElementById('testbtn').addEventListener('click', () => {
    const departure = "KORD";
    const arrival = "KDEN";
    const equipment = "B738";
    const airline = "UAL";
    const flightNum = "604";

    const simBriefURL = `https://www.simbrief.com/system/dispatch.php?airline=${airline}&fltnum=${flightNum}&orig=${departure}&dest=${arrival}&type=${equipment}`;

    window.open(simBriefURL, '_blank')
});