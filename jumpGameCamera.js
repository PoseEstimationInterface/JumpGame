import * as estimation from "pose-estimation-lib.js/dist/src/estimation";
import * as pose from "pose-estimation-lib.js/dist/src/pose";
import * as getGroundY from "pose-estimation-lib.js/dist/src/utils"
import "babel-polyfill";

import {
  drawBoundingBox,
  drawKeypoints,
  drawSkeleton,
  isMobile,
  toggleLoadingUI,
  tryResNetButtonName,
  tryResNetButtonText,
  updateTryResNetButtonDatGuiCss
} from "./jumpGameUtil";
import * as posenet from "@tensorflow-models/posenet";
import dat from "dat.gui";
import {
  detectTwoPerson,
  successReady,
  detectedJump,
} from "./jumpGameUI";

const videoWidth = 1280;
const videoHeight = 720;

let video;
let net;
let data;

const defaultQuantBytes = 2;

const defaultMobileNetMultiplier = isMobile() ? 0.5 : 0.75;
const defaultMobileNetStride = 16;
const defaultMobileNetInputResolution = 500;

const defaultResNetMultiplier = 1.0;
const defaultResNetStride = 32;
const defaultResNetInputResolution = 250;

const state = {
  personA: false,
  personB: false,
  isReady : false,
};

const guiState = {
  algorithm: "multi-pose",
  input: {
    architecture: "MobileNetV1",
    outputStride: defaultMobileNetStride,
    inputResolution: defaultMobileNetInputResolution,
    multiplier: defaultMobileNetMultiplier,
    quantBytes: defaultQuantBytes
  },
  singlePoseDetection: {
    minPoseConfidence: 0.1,
    minPartConfidence: 0.5
  },
  multiPoseDetection: {
    maxPoseDetections: 5,
    minPoseConfidence: 0.15,
    minPartConfidence: 0.1,
    nmsRadius: 30.0
  },
  output: {
    showVideo: false,
    showSkeleton: true,
    showPoints: true,
    showBoundingBox: false
  },
  net: null
};

var ground1 = [0, 0];
var groundY1 = 0;

var ground2 = [0, 0];
var groundY2 = 0;

/**
 * 바닥의 높이를 구하는 함수입니다.
 * 최근 30프레임의 평균 발 높이를 반환합니다.
 * @param pose 포즈 데이터 배열
 */

function arraySum(array) {
  return array.reduce(function (prev, curr) { return prev + curr; });
}

function getA_GroundY(pose) {
  var rightFootY = pose["keypoints"][16]["position"]["y"];
  rightFootY -= (rightFootY - groundY1) * 0.3;
  if (ground1.length > 30) {
    ground1.pop();
  }
  if (pose["keypoints"][16]["score"] > 0.5) {
    ground1.unshift(rightFootY);
  }
  groundY1 = arraySum(ground1) / ground1.length;
  return groundY1;
}

function getB_GroundY(pose) {
  var rightFootY = pose["keypoints"][16]["position"]["y"];
  rightFootY -= (rightFootY - groundY2) * 0.3;
  if (ground2.length > 30) {
    ground2.pop();
  }
  if (pose["keypoints"][16]["score"] > 0.5) {
    ground2.unshift(rightFootY);
  }
  groundY2 = arraySum(ground2) / ground2.length;
  return groundY2;
}

function setupGui(cameras, net) {
  guiState.net = net;

  if (cameras.length > 0) {
    guiState.camera = cameras[0].deviceId;
  }

  const gui = new dat.GUI({ width: 300 });

  let architectureController = null;
  guiState[tryResNetButtonName] = function() {
    architectureController.setValue("ResNet50");
  };
  gui.add(guiState, tryResNetButtonName).name(tryResNetButtonText);
  updateTryResNetButtonDatGuiCss();

  // The single-pose algorithm is faster and simpler but requires only one
  // person to be in the frame or results will be innaccurate. Multi-pose works
  // for more than 1 person
  const algorithmController = gui.add(guiState, "algorithm", [
    "single-pose",
    "multi-pose"
  ]);

  // The input parameters have the most effect on accuracy and speed of the
  // network
  let input = gui.addFolder("Input");
  // Architecture: there are a few PoseNet models varying in size and
  // accuracy. 1.01 is the largest, but will be the slowest. 0.50 is the
  // fastest, but least accurate.
  architectureController = input.add(guiState.input, "architecture", [
    "MobileNetV1",
    "ResNet50"
  ]);
  guiState.architecture = guiState.input.architecture;
  // Input resolution:  Internally, this parameter affects the height and width
  // of the layers in the neural network. The higher the value of the input
  // resolution the better the accuracy but slower the speed.
  let inputResolutionController = null;
  function updateGuiInputResolution(inputResolution, inputResolutionArray) {
    if (inputResolutionController) {
      inputResolutionController.remove();
    }
    guiState.inputResolution = inputResolution;
    guiState.input.inputResolution = inputResolution;
    inputResolutionController = input.add(
      guiState.input,
      "inputResolution",
      inputResolutionArray
    );
    inputResolutionController.onChange(function(inputResolution) {
      guiState.changeToInputResolution = inputResolution;
    });
  }

  // Output stride:  Internally, this parameter affects the height and width of
  // the layers in the neural network. The lower the value of the output stride
  // the higher the accuracy but slower the speed, the higher the value the
  // faster the speed but lower the accuracy.
  let outputStrideController = null;
  function updateGuiOutputStride(outputStride, outputStrideArray) {
    if (outputStrideController) {
      outputStrideController.remove();
    }
    guiState.outputStride = outputStride;
    guiState.input.outputStride = outputStride;
    outputStrideController = input.add(
      guiState.input,
      "outputStride",
      outputStrideArray
    );
    outputStrideController.onChange(function(outputStride) {
      guiState.changeToOutputStride = outputStride;
    });
  }

  // Multiplier: this parameter affects the number of feature map channels in
  // the MobileNet. The higher the value, the higher the accuracy but slower the
  // speed, the lower the value the faster the speed but lower the accuracy.
  let multiplierController = null;
  function updateGuiMultiplier(multiplier, multiplierArray) {
    if (multiplierController) {
      multiplierController.remove();
    }
    guiState.multiplier = multiplier;
    guiState.input.multiplier = multiplier;
    multiplierController = input.add(
      guiState.input,
      "multiplier",
      multiplierArray
    );
    multiplierController.onChange(function(multiplier) {
      guiState.changeToMultiplier = multiplier;
    });
  }

  // QuantBytes: this parameter affects weight quantization in the ResNet50
  // model. The available options are 1 byte, 2 bytes, and 4 bytes. The higher
  // the value, the larger the model size and thus the longer the loading time,
  // the lower the value, the shorter the loading time but lower the accuracy.
  let quantBytesController = null;
  function updateGuiQuantBytes(quantBytes, quantBytesArray) {
    if (quantBytesController) {
      quantBytesController.remove();
    }
    guiState.quantBytes = +quantBytes;
    guiState.input.quantBytes = +quantBytes;
    quantBytesController = input.add(
      guiState.input,
      "quantBytes",
      quantBytesArray
    );
    quantBytesController.onChange(function(quantBytes) {
      guiState.changeToQuantBytes = +quantBytes;
    });
  }

  function updateGui() {
    if (guiState.input.architecture === "MobileNetV1") {
      updateGuiInputResolution(defaultMobileNetInputResolution, [
        200,
        250,
        300,
        350,
        400,
        450,
        500,
        550,
        600,
        650,
        700,
        750,
        800
      ]);
      updateGuiOutputStride(defaultMobileNetStride, [8, 16]);
      updateGuiMultiplier(defaultMobileNetMultiplier, [0.5, 0.75, 1.0]);
    } else {
      // guiState.input.architecture === "ResNet50"
      updateGuiInputResolution(defaultResNetInputResolution, [
        200,
        250,
        300,
        350,
        400,
        450,
        500,
        550,
        600,
        650,
        700,
        750,
        800
      ]);
      updateGuiOutputStride(defaultResNetStride, [32, 16]);
      updateGuiMultiplier(defaultResNetMultiplier, [1.0]);
    }
    updateGuiQuantBytes(defaultQuantBytes, [1, 2, 4]);
  }

  updateGui();
  input.open();
  // Pose confidence: the overall confidence in the estimation of a person's
  // pose (i.e. a person detected in a frame)
  // Min part confidence: the confidence that a particular estimated keypoint
  // position is accurate (i.e. the elbow's position)
  let single = gui.addFolder("Single Pose Detection");
  single.add(guiState.singlePoseDetection, "minPoseConfidence", 0.0, 1.0);
  single.add(guiState.singlePoseDetection, "minPartConfidence", 0.0, 1.0);

  let multi = gui.addFolder("Multi Pose Detection");
  multi
    .add(guiState.multiPoseDetection, "maxPoseDetections")
    .min(1)
    .max(20)
    .step(1);
  multi.add(guiState.multiPoseDetection, "minPoseConfidence", 0.0, 1.0);
  multi.add(guiState.multiPoseDetection, "minPartConfidence", 0.0, 1.0);
  // nms Radius: controls the minimum distance between poses that are returned
  // defaults to 20, which is probably fine for most use cases
  multi
    .add(guiState.multiPoseDetection, "nmsRadius")
    .min(0.0)
    .max(40.0);
  multi.open();

  let output = gui.addFolder("Output");
  output.add(guiState.output, "showVideo");
  output.add(guiState.output, "showSkeleton");
  output.add(guiState.output, "showPoints");
  output.add(guiState.output, "showBoundingBox");
  output.open();

  architectureController.onChange(function(architecture) {
    // if architecture is ResNet50, then show ResNet50 options
    updateGui();
    guiState.changeToArchitecture = architecture;
  });

  algorithmController.onChange(function(value) {
    switch (guiState.algorithm) {
      case "single-pose":
        multi.close();
        single.open();
        break;
      case "multi-pose":
        single.close();
        multi.open();
        break;
    }
  });
}

async function setupCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      "Browser API navigator.mediaDevices.getUserMedia not available"
    );
  }

  video = document.getElementById("video");
  video.width = videoWidth;
  video.height = videoHeight;

  const mobile = isMobile();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: mobile ? undefined : videoWidth,
      height: mobile ? undefined : videoHeight
    }
  });
  video.srcObject = stream;

  return new Promise(resolve => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

async function loadVideo() {
  const video = await setupCamera();
  video.play();

  return video;
}

function detectPoseInRealTime(video) {
  const canvas = document.getElementById("output");
  const ctx = canvas.getContext("2d");

  async function poseDetectionFrame() {
    const flipPoseHorizontal = true;
    canvas.width = videoWidth;
    canvas.height = videoHeight;

    ctx.clearRect(0, 0, 40, 40);

    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-videoWidth, 0);
    ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
    ctx.restore();

    let all_poses = await guiState.net.estimatePoses(video, {
      flipHorizontal: flipPoseHorizontal,
      decodingMethod: "multi-person",
      maxDetections: guiState.multiPoseDetection.maxPoseDetections,
      scoreThreshold: guiState.multiPoseDetection.minPartConfidence,
      nmsRadius: guiState.multiPoseDetection.nmsRadius
    });
    let personCount;
    //정확도가 0.2 이상인 것만 필터링
    if (all_poses.filter(poses => poses["score"] >= 0.2).length === 1) {
      state.personA = true;
      personCount = 1;
    }
    if (all_poses.filter(poses => poses["score"] >= 0.2).length === 2) {
      state.personB = true;
      personCount = 2;
    } else {
      state.personB = false;
    }

    //jumpGameUI 에서 준비가 완료 됐는지 확인(화면에 gojump가 출력 되는지)
    var h1s = document.getElementsByTagName("h1");
    if(h1s[0].innerHTML === "go jump!!"){
      state.isReady = true;
    }
    let isTwoPerson = 1;
    //카메라에 두 명이 들어와있는지 확인
    if(!state.isReady){
      isTwoPerson = detectTwoPerson(personCount);
    }

    if(state.isReady === false && isTwoPerson){
      if (pose.isLeftHandUp(all_poses[0], 90)) {
        console.log("leftUP!!!!");
        state.isReady = successReady(true);
        console.log(state.isReady + "++++++++++++");
      }
    }

    //레디가 된 상태, 게임 시작

    else if(state.isReady === true && isTwoPerson) {
      if (all_poses.length <= 1) {
        alert("OUT!!!");
      }

      const y1 = getA_GroundY(all_poses[0]);
      const y2 = getB_GroundY(all_poses[1]);

      const jumpA = pose.isJumping(all_poses[0], y1);
      const jumpB = pose.isJumping(all_poses[1], y2);
      ctx.strokeStyle = 'red';
      canvas.width = videoWidth;
      canvas.height = videoHeight;
      // Reset the current path
      ctx.beginPath();
      // Staring point (10,45)
      ctx.moveTo(10,groundY1);
      // End point (180,47)
      ctx.lineTo(180,groundY1);
      // Make the line visible
      ctx.stroke();
      ctx.clearRect(0, 0, videoWidth, videoHeight);
      ctx.fillRect(0, y1, videoWidth, 3)


      if(jumpA){
        //alert("A")
        detectedJump("A")
      }

      if(jumpB){
        //alert("B")
        detectedJump("B")
      }

    }


    requestAnimationFrame(poseDetectionFrame);
  }

  poseDetectionFrame();
}

export async function bindPage() {
  toggleLoadingUI(true);
  net = await posenet.load({
    architecture: "ResNet50",
    outputStride: 16,
    inputResolution: 200,
    multiplier: 1,
    quantBytes: 1
  });
  console.log(11);

  console.log("initialize !");

  toggleLoadingUI(false);

  try {
    video = await loadVideo();
  } catch (e) {
    let info = document.getElementById("info");
    info.textContent =
      "this browser does not support video capture," +
      "or this device does not have a camera";
    info.style.display = "block";
    throw e;
  }

  setupGui([], net);
  detectPoseInRealTime(video);
}

navigator.getUserMedia =
  navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia;
// kick off the demo

class GetClass {
  getVideo() {
    return video;
  }
}
document.addEventListener("DOMContentLoaded", function() {
  bindPage();
});
