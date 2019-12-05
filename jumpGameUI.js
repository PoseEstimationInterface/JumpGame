const state = {
    isTwoPerson : false,
    ready : false,
    count : 5,
}

export function detectTwoPerson(persons){
    var h2s = document.getElementsByTagName("h2");
    var h1s = document.getElementsByTagName("h1");

    if(persons === 2){
        h2s[0].innerHTML = "PersonA : exist";
        h2s[1].innerHTML = "PersonB : exist";
        h1s[0].innerHTML = "READY TO GAME!! if you want to play the game, then left hand up"
        state.isTwoPerson = true;
    }
    else if(persons === 1){
        h2s[0].innerHTML = "PersonA : exist";
        h2s[1].innerHTML = "PersonB : not exist";
        h1s[0].innerHTML = "****please Two people stand.****"
    }
    return state.isTwoPerson;
}
export function successReady(isReady){
    if(isReady){
        setTimeout(()=>{
            alert(state.count);
        })
    }
}


