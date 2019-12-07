let time = 10;
//var h2s = document.getElementsByTagName("h2");
function timedCount() {
    postMessage(time);
    time--;
    if(time === 0){
        postMessage("gameOver");
    }
    setTimeout(()=>{timedCount()}, 1000);
}
timedCount();
