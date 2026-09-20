// script.js
// Main application logic: proctoring, quiz flow, calculator, timer.

// --- GLOBAL STATE ---
let examQuestions = [];        // the randomized subset for this candidate
let currentQuestionIndex = 0;
let score = 0;
let timerInterval;
let strikes = 0;
const STRIKE_LIMIT = 20;
let isProctoringActive = false;

// Motion & sound detection
let audioContext, analyser, motionCanvas, motionCtx, lastGrayData;
const SOUND_THRESHOLD = 30;
const MOTION_THRESHOLD = 500;
const PIXEL_DIFFERENCE_THRESHOLD = 20;

let strikeTimeout;

// --- ELEMENT REFERENCES ---
const videoEl = document.getElementById('video-feed');
const proctorStatusEl = document.getElementById('proctor-status');
const startBtn = document.getElementById('start-btn');
const startScreen = document.getElementById('start-screen');
const wrapper = document.getElementById('wrapper');
const strikeCounterEl = document.getElementById('strike-counter');
const strikeLogEl = document.getElementById('strike-log');
const soundBar = document.getElementById('sound-bar');
const motionBar = document.getElementById('motion-bar');
const progressEl = document.getElementById('progress');
const questionEl = document.getElementById('question');
const optionsGridEl = document.getElementById('options-grid');
const feedbackEl = document.getElementById('feedback');
const nextBtn = document.getElementById('next-btn');
const giveUpBtn = document.getElementById('give-up-btn');
const quizMainEl = document.getElementById('quiz-main');
const resultContainerEl = document.getElementById('result-container');
const scoreEl = document.getElementById('score');
const summaryEl = document.getElementById('summary');
const restartBtn = document.getElementById('restart-btn');
const timerEl = document.getElementById('timer');
const calculator = document.getElementById('calculator-container');
const display = document.getElementById('calculator-display');
const keys = document.querySelector('.calculator-keys');
const openCalcBtn = document.getElementById('open-calc-btn');
const closeCalcBtn = document.getElementById('calculator-close-btn');

// --- CALCULATOR LOGIC ---
let displayValue = '0';
let firstValue = null;
let operator = null;
let waitingForSecondValue = false;

function updateDisplay() {
  display.value = displayValue;
}
updateDisplay();

keys.addEventListener('click', (e) => {
  const { target } = e;
  if (!target.matches('button')) return;

  const { action } = target.dataset;

  if (action === 'operator') {
    handleOperator(target.value);
    return;
  }
  if (action === 'decimal') {
    inputDecimal();
    return;
  }
  if (action === 'clear') {
    clear();
    return;
  }
  if (action === 'delete') {
    deleteLast();
    return;
  }
  if (action === 'calculate') {
    try {
      const result = calculate(firstValue, operator, displayValue);
      displayValue = `${parseFloat(result.toFixed(7))}`;
      firstValue = result;
    } catch (error) {
      displayValue = 'Error';
    }
    waitingForSecondValue = true;
    operator = null;
    updateDisplay();
    return;
  }
  inputDigit(target.textContent);
  updateDisplay();
});

function inputDigit(digit) {
  if (waitingForSecondValue) {
    displayValue = digit;
    waitingForSecondValue = false;
  } else {
    displayValue = displayValue === '0' ? digit : displayValue + digit;
  }
}

function inputDecimal() {
  if (!displayValue.includes('.')) {
    displayValue += '.';
    updateDisplay();
  }
}

function clear() {
  displayValue = '0';
  firstValue = null;
  operator = null;
  waitingForSecondValue = false;
  updateDisplay();
}

function deleteLast() {
  displayValue = displayValue.slice(0, -1) || '0';
  updateDisplay();
}

function handleOperator(nextOperator) {
  const value = parseFloat(displayValue);
  if (operator && waitingForSecondValue) {
    operator = nextOperator;
    return;
  }
  if (firstValue === null) {
    firstValue = value;
  } else if (operator) {
    const result = calculate(firstValue, operator, value);
    displayValue = `${parseFloat(result.toFixed(7))}`;
    firstValue = result;
    updateDisplay();
  }
  waitingForSecondValue = true;
  operator = nextOperator;
}

function calculate(first, op, second) {
  first = parseFloat(first);
  second = parseFloat(second);
  if (op === '+') return first + second;
  if (op === '-') return first - second;
  if (op === '*') return first * second;
  if (op === '/') {
    if (second === 0) throw new Error('Division by zero');
    return first / second;
  }
  return second;
}

openCalcBtn.addEventListener('click', () => {
  calculator.style.display = 'block';
});
closeCalcBtn.addEventListener('click', () => {
  calculator.style.display = 'none';
});

// Draggable calculator
const calcHeader = document.getElementById('calculator-header');
let isDragging = false;
let offsetX, offsetY;

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
    calculator.style.top = `${e.clientY - offsetY}px`;
  }
}

function onMouseUp() {
  isDragging = false;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}

// --- QUIZ LOGIC ---
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Prepares the exam questions.
 * - Shuffles the full question bank
 * - Takes either QUESTIONS_PER_EXAM or the entire bank
 * - Shuffles each question's options too (keeping the correct index aligned)
 */
function prepareExamQuestions() {
  // Shuffle all questions
  const shuffledBank = shuffleArray([...questionBank]);

  // Decide how many questions to use
  const total = (typeof QUESTIONS_PER_EXAM === 'number' && QUESTIONS_PER_EXAM > 0)
    ? Math.min(QUESTIONS_PER_EXAM, shuffledBank.length)
    : shuffledBank.length;

  const selected = shuffledBank.slice(0, total);

  // For each selected question, shuffle its options and track the correct answer
  return selected.map((q) => {
    const optionsWithFlags = q.options.map((text, idx) => ({
      text,
      isCorrect: idx === q.correct
    }));

    shuffleArray(optionsWithFlags);

    const newOptions = optionsWithFlags.map((o) => o.text);
    const newCorrectIndex = optionsWithFlags.findIndex((o) => o.isCorrect);

    return {
      question: q.question,
      options: newOptions,
      correct: newCorrectIndex,
      explanation: q.explanation
    };
  });
}

function startTimer(duration) {
  let timer = duration;
  timerInterval = setInterval(() => {
    let minutes = Math.floor(timer / 60).toString().padStart(2, '0');
    let seconds = (timer % 60).toString().padStart(2, '0');
    timerEl.textContent = "Time Left: " + minutes + ":" + seconds;
    if (--timer < 0) {
      clearInterval(timerInterval);
      showResults("Time's up!");
    }
  }, 1000);
}

function loadQuiz() {
  if (currentQuestionIndex >= examQuestions.length) {
    showResults();
    return;
  }

  const current = examQuestions[currentQuestionIndex];

  progressEl.textContent = `Question ${currentQuestionIndex + 1} of ${examQuestions.length}`;
  questionEl.textContent = current.question;

  optionsGridEl.innerHTML = '';
  feedbackEl.innerHTML = '';
  feedbackEl.style.backgroundColor = '';
  nextBtn.style.visibility = 'hidden';
  nextBtn.textContent = 'Next';

  const correctOptionText = current.options[current.correct];
  current.options.forEach(optionText => {
    const button = document.createElement('button');
    button.textContent = optionText;
    button.className = 'option';
    if (optionText === correctOptionText) {
      button.dataset.correct = "true";
    }
    button.addEventListener('click', selectAnswer);
    optionsGridEl.appendChild(button);
  });
}

function selectAnswer(e) {
  const selectedBtn = e.target;
  const isCorrect = selectedBtn.dataset.correct === "true";
  const currentQuestion = examQuestions[currentQuestionIndex];
  const explanationText = currentQuestion.explanation || "The correct answer is highlighted.";

  if (isCorrect) {
    score++;
    selectedBtn.classList.add('correct');
    feedbackEl.innerHTML = `<p style="color: #0f5132;"><strong>Correct!</strong> ${explanationText}</p>`;
    feedbackEl.style.backgroundColor = '#d1e7dd';
  } else {
    selectedBtn.classList.add('incorrect');
    feedbackEl.innerHTML = `<p style="color: #842029;"><strong>Incorrect.</strong> ${explanationText}</p>`;
    feedbackEl.style.backgroundColor = '#f8d7da';
    Array.from(optionsGridEl.children).forEach(btn => {
      if (btn.dataset.correct === "true") {
        btn.classList.add('correct');
      }
    });
  }

  Array.from(optionsGridEl.children).forEach(btn => btn.disabled = true);
  nextBtn.style.visibility = 'visible';

  if (currentQuestionIndex >= examQuestions.length - 1) {
    nextBtn.textContent = 'Show Results';
  }
}

function showResults(reason = "Test Completed!") {
  isProctoringActive = false;
  clearInterval(timerInterval);
  if (videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(track => track.stop());
  }
  quizMainEl.style.display = 'none';
  resultContainerEl.style.display = 'block';
  resultContainerEl.querySelector('h2').textContent = reason;

  const total = examQuestions.length;
  scoreEl.textContent = `Your score: ${score} out of ${total}`;

  const percentage = total > 0 ? (score / total) * 100 : 0;
  if (percentage >= 75) {
    summaryEl.textContent = "Exceptional performance! You possess a deep and nuanced understanding.";
  } else if (percentage >= 50) {
    summaryEl.textContent = "Commendable score. You have a strong grasp but should refine your advanced knowledge.";
  } else {
    summaryEl.textContent = "A challenging test. This highlights areas for significant review and focused study.";
  }
}

nextBtn.addEventListener('click', () => {
  currentQuestionIndex++;
  if (currentQuestionIndex < examQuestions.length) {
    loadQuiz();
  } else {
    showResults();
  }
});

giveUpBtn.addEventListener('click', () => {
  showResults("Test Ended by User");
});

restartBtn.addEventListener('click', () => {
  window.location.reload();
});

// --- PROCTORING AND DETECTION LOGIC ---
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
    startScreen.style.display = 'block';
    wrapper.style.display = 'none';
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
  const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;

  const soundPercentage = Math.min(100, (average / 50) * 100);
  soundBar.style.width = `${soundPercentage}%`;

  if (average > SOUND_THRESHOLD) {
    addStrike("Significant Sound Detected");
  }
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
  const currentImageData = motionCtx.getImageData(0, 0, motionCanvas.width, motionCanvas.height);
  const currentGrayData = toGrayscale(currentImageData.data);

  let changedPixels = 0;
  if (lastGrayData) {
    for (let i = 0; i < currentGrayData.length; i++) {
      const diff = Math.abs(currentGrayData[i] - lastGrayData[i]);
      if (diff > PIXEL_DIFFERENCE_THRESHOLD) {
        changedPixels++;
      }
    }

    const motionPercentage = Math.min(100, (changedPixels / 1500) * 100);
    motionBar.style.width = `${motionPercentage}%`;

    if (changedPixels > MOTION_THRESHOLD) {
      addStrike("Excessive Motion Detected");
    }
  }
  lastGrayData = currentGrayData;
}

function addStrike(reason) {
  if (strikeTimeout) return;
  strikes++;
  strikeCounterEl.textContent = `Total Strikes: ${strikes} / ${STRIKE_LIMIT}`;
  strikeLogEl.textContent = `Warning: ${reason}`;
  if (strikes >= STRIKE_LIMIT) {
    showResults("Test Terminated: Violation Limit Exceeded");
  }
  strikeTimeout = setTimeout(() => {
    strikeTimeout = null;
    strikeLogEl.textContent = "System Ready";
  }, 2000);
}

// --- MAIN INITIALIZER ---
document.addEventListener('DOMContentLoaded', () => {
  const entryCodeInput = document.getElementById('entry-code');
  const codeMessageEl = document.getElementById('code-message');

  // Live-validate as the user types (reset visual state)
  entryCodeInput.addEventListener('input', () => {
    entryCodeInput.classList.remove('error', 'success');
    codeMessageEl.textContent = '';
    codeMessageEl.className = 'code-message';
  });

  entryCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startBtn.click();
  });

  startBtn.addEventListener('click', async () => {
    const enteredCode = entryCodeInput.value;

    // 1. Validate the entry code
    const result = validateEntryCode(enteredCode);

    if (!result.valid) {
      entryCodeInput.classList.add('error');
      entryCodeInput.classList.remove('success');

      if (result.reason === 'not_found') {
        codeMessageEl.textContent = 'Invalid entry code. Please check and try again.';
      } else if (result.reason === 'used') {
        codeMessageEl.textContent = `This code has already been used${result.user ? ` by ${result.user.name}` : ''}.`;
      }
      codeMessageEl.className = 'code-message error';
      return;
    }

    // 2. Show success state
    entryCodeInput.classList.remove('error');
    entryCodeInput.classList.add('success');
    codeMessageEl.textContent = `Welcome, ${result.user.name}!`;
    codeMessageEl.className = 'code-message success';

    // 3. Disable UI while we set up proctoring
    startBtn.disabled = true;
    entryCodeInput.disabled = true;

    startScreen.style.display = 'none';
    wrapper.style.display = 'flex';

    const proctoringReady = await setupProctoring();

    if (proctoringReady) {
      // 4. Consume the code (unless demo) NOW that proctoring succeeded
      consumeEntryCode(result.user);

      // 5. Personalise the header
      const headerTitle = document.querySelector('#quiz-header h1');
      if (headerTitle) {
        headerTitle.textContent = `CBT — ${result.user.name}`;
      }

      // 6. Build the randomized exam for this candidate
      examQuestions = prepareExamQuestions();
      currentQuestionIndex = 0;
      score = 0;

      startTimer(60 * 40); // 40 minutes
      loadQuiz();
    } else {
      // Proctoring failed — restore the start screen so they can retry
      startScreen.style.display = 'block';
      wrapper.style.display = 'none';
      startBtn.disabled = false;
      entryCodeInput.disabled = false;
      entryCodeInput.classList.remove('success');
      codeMessageEl.textContent = '';
      codeMessageEl.className = 'code-message';
    }
  });
});