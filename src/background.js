'use strict';

// With background scripts you can communicate with popup
// and contentScript files.
// For more information on background script,
// See https://developer.chrome.com/extensions/background_pages

const TIMER_STORAGE_KEY = 'timerState';
const CURRENCY_STORAGE_KEY = 'currencyState';

// Testing default: 1 point per second. Change this to tune conversion later.
const MS_PER_POINT = 1000;

function getDefaultTimerState() {
	return {
		isRunning: false,
		startTimestampMs: null,
		elapsedMs: 0
	};
}

function getDefaultCurrencyState() {
	return {
		totalPoints: 0
	};
}

function sanitizePoints(value) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.floor(value));
}

function getStoredTimerState() {
	return new Promise((resolve) => {
		chrome.storage.local.get([TIMER_STORAGE_KEY], (result) => {
			const storedState = result[TIMER_STORAGE_KEY] || {};
			resolve({
				...getDefaultTimerState(),
				...storedState
			});
		});
	});
}

function setStoredTimerState(nextState) {
	return new Promise((resolve) => {
		chrome.storage.local.set({ [TIMER_STORAGE_KEY]: nextState }, () => {
			resolve();
		});
	});
}

function getStoredCurrencyState() {
	return new Promise((resolve) => {
		chrome.storage.local.get([CURRENCY_STORAGE_KEY], (result) => {
			const storedState = result[CURRENCY_STORAGE_KEY] || {};
			resolve({
				...getDefaultCurrencyState(),
				totalPoints: sanitizePoints(storedState.totalPoints)
			});
		});
	});
}

function setStoredCurrencyState(nextState) {
	return new Promise((resolve) => {
		chrome.storage.local.set(
			{ [CURRENCY_STORAGE_KEY]: { totalPoints: sanitizePoints(nextState.totalPoints) } },
			() => {
				resolve();
			}
		);
	});
}

function getElapsedMs(state) {
	if (!state.isRunning || !state.startTimestampMs) {
		return state.elapsedMs;
	}

	return Math.max(0, Date.now() - state.startTimestampMs);
}


function getRunningPoints(elapsedMs) {
	return Math.floor(Math.max(0, elapsedMs) / MS_PER_POINT);
}

function toResponseState(timerState, currencyState) {
	const elapsedMs = getElapsedMs(timerState);
	const basePoints = sanitizePoints(currencyState.totalPoints);

	return {
		...timerState,
		elapsedMs,
		elapsedSeconds: Math.floor(elapsedMs / 1000),
		points: basePoints,
		msPerPoint: MS_PER_POINT,
		earnedPoints: 0,
		earnedElapsedMs: 0
	};
}

async function handleToggleTimer() {
	const [currentTimer, currentCurrency] = await Promise.all([
		getStoredTimerState(),
		getStoredCurrencyState()
	]);

	if (currentTimer.isRunning) {
		const elapsedMs = getElapsedMs(currentTimer);
		const earnedPoints = getRunningPoints(elapsedMs);
		const nextCurrency = {
			totalPoints: sanitizePoints(currentCurrency.totalPoints) + earnedPoints
		};
		const stoppedState = {
			isRunning: false,
			startTimestampMs: null,
			elapsedMs: 0
		};

		await Promise.all([
			setStoredTimerState(stoppedState),
			setStoredCurrencyState(nextCurrency)
		]);

		return {
			...toResponseState(stoppedState, nextCurrency),
			earnedPoints,
			earnedElapsedMs: elapsedMs
		};
	}

	const startedState = {
		isRunning: true,
		startTimestampMs: Date.now(),
		elapsedMs: 0
	};

	await setStoredTimerState(startedState);
	return toResponseState(startedState, currentCurrency);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || !message.type) {
		return;
	}

	if (message.type === 'TIMER_GET_STATE') {
		Promise.all([getStoredTimerState(), getStoredCurrencyState()])
			.then(([timerState, currencyState]) => {
				sendResponse({ ok: true, state: toResponseState(timerState, currencyState) });
			})
			.catch((error) => {
				sendResponse({ ok: false, error: error.message });
			});

		return true;
	}

	if (message.type === 'TIMER_TOGGLE') {
		handleToggleTimer()
			.then((state) => {
				sendResponse({ ok: true, state });
			})
			.catch((error) => {
				sendResponse({ ok: false, error: error.message });
			});

		return true;
	}
});
