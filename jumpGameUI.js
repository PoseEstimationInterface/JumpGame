import swal from 'sweetalert'; //이쁜 경고창

const state = {
    isTwoPerson : false,
    ready : false,
    count : 5,
    isReady : false,
    endGame: false,
    jumpCountA : 1,
    jumpCountB : 1,
}
var h2s = document.getElementsByTagName("h2");
var h1s = document.getElementsByTagName("h1");
let count = 5;

export function detectTwoPerson(person){
    console.log(person)
    if(person === 2 && count === 5){
        h2s[0].innerHTML = "READY";
        h2s[1].innerHTML = "READY";
        h1s[0].innerHTML = "READY TO GAME!! if you want to play the game, then left hand up"
        state.isTwoPerson = true;
    }
    else if(person === 1 && count === 5){
        h2s[0].innerHTML = "READY";
        h2s[1].innerHTML = "";
        h1s[0].innerHTML = "****please Two people stand.****"
    }
    return state.isTwoPerson;
}
export function successReady(isReady){
    setTimeout(()=>{
        if(count !== -1){
            h1s[0].innerHTML = count.toString();
            count--;
            if(count === -1){
                h1s[0].innerHTML = "";
                //시간을 병렬로 돌리기 위함.
                let w = new Worker("./timeWorker.js");
                w.onmessage = function(e){
                    //게임이 끝나면 경고창 출력. 경고창에 승리자 정보 표시.
                    if(e.data === "gameOver"){
                        state.endGame = e.data;
                        w.terminate();
                        w = undefined;
                        const winner = choiceWinner();
                        swal("winner is Player " + winner);
                        count = 5;

                    }
                    console.log(e.data);
                };

                state.isReady = true;
            }
        }
        successReady(true);
    }, 1000);
}
export function getIsReady(){
    return state.isReady;
}

export function detectedJump(player){
    if(player === 'A'){
        h2s[0].innerHTML = state.jumpCountA.toString();
        state.jumpCountA++;
    }
    if(player === 'B'){
        h2s[1].innerHTML =  state.jumpCountB.toString();
        state.jumpCountB++;
    }
}
function choiceWinner(){
    return state.jumpCountA > state.jumpCountB ? "A" : "B";
}
