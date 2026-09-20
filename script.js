// ============================================================
// script.js — CBT client (server-authoritative grading)
// ============================================================

// ---------- CONFIG ----------
const API_URL = "https://script.google.com/macros/s/AKfycbyn6jOh5ludkjpLG-_vai3H2HHAooH8t1LMJMJSKnjs13A4LHCoya3nJAVUYLG6M8iaAg/exec";
// ↑ Replace with your own deployment URL after deploying Code.gs

// ---------- GLOBAL STATE ----------
let sessionToken = null;
let examQuestions = [];              // [{ id, question, options }] — NO answers
let currentQuestionIndex = 0;
let userAnswers = {};                // { questionId: chosenText }
let timerInterval = null;
let strikes = 0;
const STRIKE_LIMIT = 20;
let isProctoringActive = false;
let examDurationSec = 40 * 60;
let candidate = null;
let submissionInFlight = false;

// Motion & sound detection
let audioContext, analyser, motionCanvas, motionCtx, lastGrayData;
const SOUND_THRESHOLD = 30;
const MOTION_THRESHOLD = 500;
const PIXEL_DIFFERENCE_THRESHOLD = 20;
let strikeTimeout;

// ---------- DOM ----------
const videoEl          = document.getElementById('video-feed');
const proctorStatusEl  = document.getElementById('proctor-status');
const startBtn         = document.getElementById('start-btn');
const startScreen      = document.getElementById('start-screen');
const wrapper          = document.getElementById('wrapper');
const strikeCounterEl  = document.getElementById('strike-counter');
const strikeLogEl      = document.getElementById('strike-log');
const soundBar         = document.getElementById('sound-bar');
const motionBar        = document.getElementById('motion-bar');
const progressEl       = document.getElementById('progress');
const questionEl       = document.getElementById('question');
const optionsGridEl    = document.getElementById('options-grid');
const feedbackEl       = document.getElementById('feedback');
const nextBtn          = document.getElementById('next-btn');
const giveUpBtn        = document.getElementById('give-up-btn');
const quizMainEl       = document.getElementById('quiz-main');
const resultContainerEl= document.getElementById('result-container');
const scoreEl          = document.getElementById('score');
const summaryEl        = document.getElementById('summary');
const restartBtn       = document.getElementById('restart-btn');
const timerEl          = document.getElementById('timer');
const calculator       = document.getElementById('calculator-container');
const display          = document.getElementById('calculator-display');
const keys             = document.querySelector('.calculator-keys');
const openCalcBtn      = document.getElementById('open-calc-btn');
const closeCalcBtn     = document.getElementById('calculator-close-btn');
const entryCodeInput   = document.getElementById('entry-code');
const codeMessageEl    = document.getElementById('code-message');

// ============================================================
// CALCULATOR
// ============================================================
let displayValue = '0';
let firstValue = null;
let operator = null;
let waitingForSecondValue = false;

function updateDisplay() { display.value = displayValue; }
updateDisplay();

keys.addEventListener('click', (e) => {
  const { target } = e;
  if (!target.matches('button')) return;
  const { action } = target.dataset;

  if (action === 'operator') return handleOperator(target.value);
  if (action === 'decimal')  return inputDecimal();
  if (action === 'clear')    return clear();
  if (action === 'delete')   return deleteLast();
  if (action === 'calculate') {
    try {
      const result = calculate(firstValue, operator, displayValue);
      displayValue = `${parseFloat(result.toFixed(7))}`;
      firstValue = result;
    } catch { displayValue = 'Error'; }
    waitingForSecondValue = true;
    operator = null;
    updateDisplay();
    return;
  }
  inputDigit(target.textContent);
  updateDisplay();
});

function inputDigit(d) {
  if (waitingForSecondValue) { displayValue = d; waitingForSecondValue = false; }
  else { displayValue = displayValue === '0' ? d : displayValue + d; }
}
function inputDecimal() {
  if (!displayValue.includes('.')) { displayValue += '.'; updateDisplay(); }
}
function clear() {
  displayValue = '0'; firstValue = null; operator = null;
  waitingForSecondValue = false; updateDisplay();
}
function deleteLast() {
  displayValue = displayValue.slice(0, -1) || '0'; updateDisplay();
}
function handleOperator(next) {
  const value = parseFloat(displayValue);
  if (operator && waitingForSecondValue) { operator = next; return; }
  if (firstValue === null) firstValue = value;
  else if (operator) {
    const result = calculate(firstValue, operator, value);
    displayValue = `${parseFloat(result.toFixed(7))}`;
    firstValue = result; updateDisplay();
  }
  waitingForSecondValue = true; operator = next;
}
function calculate(a, op, b) {
  a = parseFloat(a); b = parseFloat(b);
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') { if (b === 0) throw new Error('div0'); return a / b; }
  return b;
}

openCalcBtn.addEventListener('click', () => calculator.style.display = 'block');
closeCalcBtn.addEventListener('click', () => calculator.style.display = 'none');

// Draggable calculator
const calcHeader = document.getElementById('calculator-header');
let isDragging = false, offsetX, offsetY;
calcHeader.addEventListener('mousedown', (e) => {
  isDragging = true;
  offsetX = e.clientX - calculator.offsetLeft;
  offsetY = e.clientY - calculator.offsetTop;
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});
function onMouseMove(e) {
  if (isDragging) {
    calculator.style.left = `${e.clientX - offsetX}px`;
    calculator.style.top  = `${e.clientY - offsetY}px`;
  }
}
function onMouseUp() {
  isDragging = false;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}

// ============================================================
// API — start + submit
// ============================================================
async function apiStart(code) {
  const res = await fetch(API_URL, {
    method: "POST",
    // text/plain avoids CORS preflight with Apps Script
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "start", code })
  });
  return res.json();
}

async function apiSubmit(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "submit", ...payload })
  });
  return res.json();
}

// ============================================================
// TIMER
// ============================================================
function startTimer(duration) {
  let timer = duration;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const m = Math.floor(timer / 60).toString().padStart(2, '0');
    const s = (timer % 60).toString().padStart(2, '0');
    timerEl.textContent = `Time Left: ${m}:${s}`;
    if (--timer < 0) {
      clearInterval(timerInterval);
      handleSubmit("Time's up!");
    }
  }, 1000);
}

// ============================================================
// QUIZ FLOW
// ============================================================
function loadQuiz() {
  if (currentQuestionIndex >= examQuestions.length) return handleSubmit();
  const q = examQuestions[currentQuestionIndex];

  progressEl.textContent = `Question ${currentQuestionIndex + 1} of ${examQuestions.length}`;
  questionEl.textContent = q.question;

  optionsGridEl.innerHTML = '';
  feedbackEl.innerHTML = '';
  feedbackEl.style.backgroundColor = '';
  nextBtn.style.visibility = 'hidden';
  nextBtn.textContent = (currentQuestionIndex === examQuestions.length - 1)
    ? 'Submit Test' : 'Next';

  // If already answered (user navigated back) show selection state
  const priorChoice = userAnswers[q.id];

  q.options.forEach(text => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.className = 'option';
    btn.dataset.qid = q.id;
    btn.dataset.choice = text;
    if (priorChoice === text) btn.classList.add('selected');
    btn.addEventListener('click', selectAnswer);
    optionsGridEl.appendChild(btn);
  });
}

function selectAnswer(e) {
  const btn = e.target;
  const qId = btn.dataset.qid;
  const choice = btn.dataset.choice;

  // Save selection (server holds the answer key, so no correctness feedback now)
  userAnswers[qId] = choice;

  Array.from(optionsGridEl.children).forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  // Reveal Next button
  nextBtn.style.visibility = 'visible';
}

nextBtn.addEventListener('click', () => {
  currentQuestionIndex++;
  loadQuiz();
});

giveUpBtn.addEventListener('click', () => handleSubmit("Test Ended by User"));

restartBtn.addEventListener('click', () => window.location.reload());

// ============================================================
// SUBMIT — server grades, then we show results
// ============================================================
async function handleSubmit(reason = "Test Completed!") {
  if (submissionInFlight) return;
  submissionInFlight = true;
  isProctoringActive = false;
  clearInterval(timerInterval);

  if (videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
  }

  // Show spinner on result screen
  quizMainEl.style.display = 'none';
  resultContainerEl.style.display = 'block';
  resultContainerEl.querySelector('h2').textContent = "Submitting...";
  scoreEl.textContent = "Grading on server…";
  summaryEl.textContent = "";

  try {
    const result = await apiSubmit({
      token: sessionToken,
      answers: userAnswers,
      strikes: strikes,
      reason: reason
    });

    if (result.status !== "ok") {
      resultContainerEl.querySelector('h2').textContent = "Submission Error";
      scoreEl.textContent = `Could not submit: ${result.code || result.message}`;
      summaryEl.textContent = "Please contact your exam administrator.";
      return;
    }

    // Show final results
    resultContainerEl.querySelector('h2').textContent = reason;
    scoreEl.textContent = `Your score: ${result.score} out of ${result.total} (${result.percentage}%)`;

    if (result.percentage >= 75) {
      summaryEl.textContent = "Exceptional performance!.";
    } else if (result.percentage >= 50) {
      summaryEl.textContent = "Commendable score!.";
    } else {
      summaryEl.textContent = "Advised to re-sit";
    }
  } catch (err) {
    console.error("Submission failed:", err);
    resultContainerEl.querySelector('h2').textContent = "Network Error";
    scoreEl.textContent = "Your answers could not be sent to the server.";
    summaryEl.textContent = "Please check your connection and notify the exam administrator.";
  } finally {
    submissionInFlight = false;
  }
}

// ============================================================
// PROCTORING
// ============================================================
async function setupProctoring() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoEl.srcObject = stream;
    await videoEl.play();

    proctorStatusEl.textContent = "Monitoring Active";
    proctorStatusEl.classList.add("monitoring");

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 512;

    motionCanvas = document.createElement('canvas');
    motionCanvas.width = 120;
    motionCanvas.height = 90;
    motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });

    isProctoringActive = true;
    requestAnimationFrame(runProctoringChecks);
    return true;
  } catch (err) {
    console.error("Proctoring setup failed:", err);
    proctorStatusEl.textContent = "Access Denied";
    proctorStatusEl.classList.add("error");
    alert("Webcam and Microphone access is required. Please allow access and try again.");
    return false;
  }
}

function runProctoringChecks() {
  if (!isProctoringActive) return;
  detectSound();
  detectMotion();
  requestAnimationFrame(runProctoringChecks);
}

function detectSound() {
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(dataArray);
  const average = dataArray.reduce((a, v) => a + v, 0) / dataArray.length;
  soundBar.style.width = `${Math.min(100, (average / 50) * 100)}%`;
  if (average > SOUND_THRESHOLD) addStrike("Significant Sound Detected");
}

function toGrayscale(data) {
  const gray = new Uint8Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  return gray;
}

function detectMotion() {
  if (videoEl.readyState < videoEl.HAVE_CURRENT_DATA) return;
  motionCtx.drawImage(videoEl, 0, 0, motionCanvas.width, motionCanvas.height);
  const img = motionCtx.getImageData(0, 0, motionCanvas.width, motionCanvas.height);
  const gray = toGrayscale(img.data);

  if (lastGrayData) {
    let changed = 0;
    for (let i = 0; i < gray.length; i++) {
      if (Math.abs(gray[i] - lastGrayData[i]) > PIXEL_DIFFERENCE_THRESHOLD) changed++;
    }
    motionBar.style.width = `${Math.min(100, (changed / 1500) * 100)}%`;
    if (changed > MOTION_THRESHOLD) addStrike("Excessive Motion Detected");
  }
  lastGrayData = gray;
}

function addStrike(reason) {
  if (strikeTimeout) return;
  strikes++;
  strikeCounterEl.textContent = `Total Strikes: ${strikes} / ${STRIKE_LIMIT}`;
  strikeLogEl.textContent = `Warning: ${reason}`;
  if (strikes >= STRIKE_LIMIT) {
    handleSubmit("Test Terminated: Violation Limit Exceeded");
    return;
  }
  strikeTimeout = setTimeout(() => {
    strikeTimeout = null;
    strikeLogEl.textContent = "System Ready";
  }, 2000);
}

// ============================================================
// ENTRY CODE + START
// ============================================================
entryCodeInput.addEventListener('input', () => {
  entryCodeInput.classList.remove('error', 'success');
  codeMessageEl.textContent = '';
  codeMessageEl.className = 'code-message';
});
entryCodeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') startBtn.click();
});

startBtn.addEventListener('click', async () => {
  const enteredCode = entryCodeInput.value.trim();
  if (!enteredCode) {
    entryCodeInput.classList.add('error');
    codeMessageEl.textContent = 'Please enter your entry code.';
    codeMessageEl.className = 'code-message error';
    return;
  }

  // Disable UI while we contact the server
  startBtn.disabled = true;
  startBtn.textContent = "Verifying…";
  codeMessageEl.textContent = "";
  codeMessageEl.className = 'code-message';

  let startResult;
  try {
    startResult = await apiStart(enteredCode);
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = "Get Started";
    entryCodeInput.classList.add('error');
    codeMessageEl.textContent = 'Network error. Please check your connection and try again.';
    codeMessageEl.className = 'code-message error';
    return;
  }

  if (startResult.status !== "ok") {
    startBtn.disabled = false;
    startBtn.textContent = "Get Started";
    entryCodeInput.classList.add('error');
    if (startResult.code === "not_found") {
      codeMessageEl.textContent = 'Invalid entry code. Please check and try again.';
    } else if (startResult.code === "used") {
      codeMessageEl.textContent = `This code has already been used${startResult.name ? ` by ${startResult.name}` : ''}.`;
    } else {
      codeMessageEl.textContent = startResult.message || 'Unable to start exam.';
    }
    codeMessageEl.className = 'code-message error';
    return;
  }

  // Success
  entryCodeInput.classList.add('success');
  entryCodeInput.disabled = true;
  codeMessageEl.textContent = `Welcome, ${startResult.candidateName}!`;
  codeMessageEl.className = 'code-message success';

  candidate = { name: startResult.candidateName };
  sessionToken = startResult.token;
  examQuestions = startResult.questions;
  examDurationSec = startResult.duration || 2400;
  currentQuestionIndex = 0;
  userAnswers = {};
  strikes = 0;
  strikeCounterEl.textContent = `Total Strikes: 0 / ${STRIKE_LIMIT}`;

  startScreen.style.display = 'none';
  wrapper.style.display = 'flex';

  const proctorReady = await setupProctoring();
  if (!proctorReady) {
    // Restore start screen so they can retry
    startScreen.style.display = 'block';
    wrapper.style.display = 'none';
    startBtn.disabled = false;
    startBtn.textContent = "Get Started";
    entryCodeInput.disabled = false;
    entryCodeInput.classList.remove('success');
    codeMessageEl.textContent = '';
    codeMessageEl.className = 'code-message';
    return;
  }

  // Personalize header
  const headerTitle = document.querySelector('#quiz-header h1');
  if (headerTitle) headerTitle.textContent = `CBT — ${candidate.name}`;

  startTimer(examDurationSec);
  loadQuiz();
});
