'use strict';

import './popup.css';

const timerButton = document.getElementById('timerButton');
const timerDisplay = document.getElementById('timerDisplay');
const coinCountDisplay = document.querySelector('.coin-button__count');

let uiIntervalId = null;
let lastKnownState = null;
let isToggling = false;

function formatElapsed(totalSeconds) {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
	const state = await sendRuntimeMessage({ type: 'TIMER_TOGGLE' });
	renderFromState(state);
	syncUiTickerWithState(state);
	return state;
}

if (timerButton && timerDisplay) {
	refreshState().catch(() => {
		timerDisplay.textContent = formatElapsed(0);
		timerButton.textContent = 'Click to start timer';
	});

	timerButton.addEventListener('click', async () => {
		if (isToggling) {
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

