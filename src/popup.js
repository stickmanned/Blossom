'use strict';

import './popup.css';

const timerButton = document.getElementById('timerButton');
const timerDisplay = document.getElementById('timerDisplay');
const coinCountDisplay = document.querySelector('.coin-button__count');

const COIN_SOUND_PATHS = [
	chrome.runtime.getURL('sounds/coins-1.wav'),
	chrome.runtime.getURL('sounds/coins-2.wav'),
	chrome.runtime.getURL('sounds/coins-3.wav'),
	chrome.runtime.getURL('sounds/coins-4.wav')
];

let uiIntervalId = null;
let lastKnownState = null;
let isToggling = false;
let isAnimatingStop = false;
let shouldPlayContinuousCoinSound = false;
let continuousCoinAudio = null;
let coinSoundRunId = 0;
let coinSoundRetryTimeoutId = null;

function formatElapsed(totalSeconds) {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function sleep(ms) {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

function cleanupContinuousCoinAudio() {
	if (!continuousCoinAudio) {
		return;
	}

	continuousCoinAudio.onended = null;
	continuousCoinAudio.onerror = null;
	continuousCoinAudio.pause();
	continuousCoinAudio.currentTime = 0;
	continuousCoinAudio = null;
}

function stopContinuousCoinSound(forceStop = false) {
	shouldPlayContinuousCoinSound = false;

	if (coinSoundRetryTimeoutId !== null) {
		window.clearTimeout(coinSoundRetryTimeoutId);
		coinSoundRetryTimeoutId = null;
	}

	if (!continuousCoinAudio) {
		return;
	}

	if (forceStop || continuousCoinAudio.paused) {
		coinSoundRunId += 1;
		cleanupContinuousCoinAudio();
		return;
	}

	const runIdAtStop = coinSoundRunId;
	continuousCoinAudio.onended = () => {
		if (runIdAtStop !== coinSoundRunId) {
			return;
		}

		coinSoundRunId += 1;
		cleanupContinuousCoinAudio();
	};
	continuousCoinAudio.onerror = () => {
		if (runIdAtStop !== coinSoundRunId) {
			return;
		}

		coinSoundRunId += 1;
		cleanupContinuousCoinAudio();
	};
}

function pickRandomCoinSoundPath() {
	const randomIndex = Math.floor(Math.random() * COIN_SOUND_PATHS.length);
	return COIN_SOUND_PATHS[randomIndex];
}

function scheduleCoinSoundRetry(runId) {
	if (!shouldPlayContinuousCoinSound || runId !== coinSoundRunId) {
		return;
	}

	coinSoundRetryTimeoutId = window.setTimeout(() => {
		coinSoundRetryTimeoutId = null;
		playContinuousCoinTick(runId);
	}, 60);
}

function playContinuousCoinTick(runId) {
	if (!shouldPlayContinuousCoinSound || runId !== coinSoundRunId || !continuousCoinAudio) {
		return;
	}

	const audio = continuousCoinAudio;
	audio.src = pickRandomCoinSoundPath();
	audio.currentTime = 0;
	audio.volume = 0.5;
	const playPromise = audio.play();

	if (playPromise && typeof playPromise.then === 'function') {
		playPromise.catch(() => {
			if (!shouldPlayContinuousCoinSound || runId !== coinSoundRunId) {
				return;
			}

			scheduleCoinSoundRetry(runId);
		});
	}
}

function startContinuousCoinSound() {
	if (shouldPlayContinuousCoinSound) {
		return;
	}

	shouldPlayContinuousCoinSound = true;

	if (!continuousCoinAudio) {
		continuousCoinAudio = new Audio();
		continuousCoinAudio.preload = 'auto';
		const runId = coinSoundRunId;
		continuousCoinAudio.onended = () => {
			if (!shouldPlayContinuousCoinSound || runId !== coinSoundRunId) {
				return;
			}

			playContinuousCoinTick(runId);
		};
		continuousCoinAudio.onerror = () => {
			if (!shouldPlayContinuousCoinSound || runId !== coinSoundRunId) {
				return;
			}

			scheduleCoinSoundRetry(runId);
		};
	}

	coinSoundRunId += 1;
	const activeRunId = coinSoundRunId;

	if (continuousCoinAudio) {
		continuousCoinAudio.onended = () => {
			if (!shouldPlayContinuousCoinSound || activeRunId !== coinSoundRunId) {
				return;
			}

			playContinuousCoinTick(activeRunId);
		};
		continuousCoinAudio.onerror = () => {
			if (!shouldPlayContinuousCoinSound || activeRunId !== coinSoundRunId) {
				return;
			}

			scheduleCoinSoundRetry(activeRunId);
		};
	}

	playContinuousCoinTick(activeRunId);
}

function sendRuntimeMessage(message) {
	return new Promise((resolve, reject) => {
		let isSettled = false;
		const timeoutId = window.setTimeout(() => {
			if (isSettled) {
				return;
			}

			isSettled = true;
			reject(new Error('Timer request timed out'));
		}, 4000);

		chrome.runtime.sendMessage(message, (response) => {
			if (isSettled) {
				return;
			}

			isSettled = true;
			window.clearTimeout(timeoutId);

			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
				return;
			}

			if (!response || !response.ok) {
				reject(new Error(response?.error || 'Unknown timer error'));
				return;
			}

			resolve(response.state);
		});
	});
}

function getElapsedSeconds(state) {
	if (!state) {
		return 0;
	}

	if (state.isRunning && state.startTimestampMs) {
		return Math.floor(Math.max(0, Date.now() - state.startTimestampMs) / 1000);
	}

	return Math.floor((state.elapsedMs || 0) / 1000);
}

function renderFromState(state) {
	lastKnownState = state;

	timerDisplay.textContent = formatElapsed(getElapsedSeconds(state));
	timerButton.textContent = state.isRunning ? 'Click to stop timer' : 'Click to start timer';

	if (coinCountDisplay) {
		coinCountDisplay.textContent = String(Math.max(0, state.points || 0));
	}
}

function startUiTicker() {
	if (uiIntervalId !== null) {
		window.clearInterval(uiIntervalId);
	}

	uiIntervalId = window.setInterval(() => {
		if (!lastKnownState || !lastKnownState.isRunning) {
			return;
		}

		timerDisplay.textContent = formatElapsed(getElapsedSeconds(lastKnownState));
	}, 1000);
}

function stopUiTicker() {
	if (uiIntervalId === null) {
		return;
	}

	window.clearInterval(uiIntervalId);
	uiIntervalId = null;
}

function syncUiTickerWithState(state) {
	if (state.isRunning) {
		startUiTicker();
		return;
	}

	stopUiTicker();
}

async function refreshState() {
	const state = await sendRuntimeMessage({ type: 'TIMER_GET_STATE' });
	renderFromState(state);
	syncUiTickerWithState(state);
}

async function toggleTimer() {
	const wasRunning = Boolean(lastKnownState?.isRunning);
	const state = await sendRuntimeMessage({ type: 'TIMER_TOGGLE' });

	const shouldAnimateStop =
		wasRunning &&
		!state.isRunning &&
		(Math.max(0, state.earnedElapsedMs || 0) > 0 || Math.max(0, state.earnedPoints || 0) > 0);

	if (shouldAnimateStop) {
		isAnimatingStop = true;
		try {
			await animateStopConversion(state);
		} finally {
			isAnimatingStop = false;
		}
	}

	renderFromState(state);
	syncUiTickerWithState(state);
	return state;
}

async function animateStopConversion(state) {
	const earnedElapsedMs = Math.max(0, Math.floor(state.earnedElapsedMs || 0));
	const earnedPoints = Math.max(0, Math.floor(state.earnedPoints || 0));
	const finalPoints = Math.max(0, Math.floor(state.points || 0));
	const startingPoints = Math.max(0, finalPoints - earnedPoints);

	if (coinCountDisplay) {
		coinCountDisplay.textContent = String(startingPoints);
	}

	timerButton.textContent = 'Click to start timer';

	const totalSteps = Math.max(1, earnedPoints, Math.floor(earnedElapsedMs / 1000));
	const delayPerStepMs = Math.max(50, Math.min(180, Math.floor(4000 / totalSteps)));

	if (earnedPoints > 0) {
		startContinuousCoinSound();
	}

	try {
		for (let step = 1; step <= totalSteps; step += 1) {
			const consumedMs = Math.floor((earnedElapsedMs * step) / totalSteps);
			const remainingMs = Math.max(0, earnedElapsedMs - consumedMs);
			timerDisplay.textContent = formatElapsed(Math.floor(remainingMs / 1000));

			const appliedPoints = Math.floor((earnedPoints * step) / totalSteps);
			if (coinCountDisplay) {
				coinCountDisplay.textContent = String(startingPoints + appliedPoints);
			}

			await sleep(delayPerStepMs);
		}
	} finally {
		stopContinuousCoinSound();
	}

	timerDisplay.textContent = formatElapsed(0);
	if (coinCountDisplay) {
		coinCountDisplay.textContent = String(finalPoints);
	}
}

if (timerButton && timerDisplay) {
	refreshState().catch(() => {
		timerDisplay.textContent = formatElapsed(0);
		timerButton.textContent = 'Click to start timer';
	});

	timerButton.addEventListener('click', async () => {
		if (isToggling || isAnimatingStop) {
			return;
		}

		isToggling = true;

		try {
			await toggleTimer();
		} catch (_error) {
			await refreshState().catch(() => {
				timerDisplay.textContent = formatElapsed(0);
				timerButton.textContent = 'Click to start timer';
			});
		} finally {
			isToggling = false;
		}
	});
}

