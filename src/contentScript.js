'use strict';

// Content script file will run in the context of web page.
// With content script you can manipulate the web pages using
// Document Object Model (DOM).
// You can also pass information to the parent extension.

// We execute this script by making an entry in manifest.json file
// under `content_scripts` property

// For more information on Content Scripts,
// See https://developer.chrome.com/extensions/content_scripts

const TIMER_STORAGE_KEY = 'timerState';
const BLOCKED_DOMAINS_KEY = 'blockedDomains';
const LOCK_CLASS_NAME = 'blossom-lock-active';
const OVERLAY_ID = 'blossom-lock-overlay';
const STYLE_ID = 'blossom-lock-style';
const LOCK_MESSAGE = 'Stay focused, you are doing great.';

let isLockApplied = false;

function getStorageLocal(keys) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.get(keys, (result) => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
				return;
			}

			resolve(result);
		});
	});
}

function normalizeDomain(value) {
	return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function domainMatches(hostname, blockedDomain) {
	if (!blockedDomain) {
		return false;
	}

	return hostname === blockedDomain || hostname.endsWith(`.${blockedDomain}`);
}

function ensureLockStyle() {
	if (document.getElementById(STYLE_ID)) {
		return;
	}

	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
html.${LOCK_CLASS_NAME} body {
	overflow: hidden !important;
}

html.${LOCK_CLASS_NAME} body *:not(#${OVERLAY_ID}):not(#${OVERLAY_ID} *) {
	filter: blur(6px) !important;
	pointer-events: none !important;
	user-select: none !important;
}

#${OVERLAY_ID} {
	position: fixed;
	inset: 0;
	z-index: 2147483647;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.2);
	pointer-events: auto;
}

#${OVERLAY_ID} .blossom-lock-modal {
	padding: 24px 30px;
	border-radius: 14px;
	background: rgba(20, 20, 20, 0.9);
	border: 2px solid rgba(255, 255, 255, 0.2);
	color: #ffffff;
	font-family: Arial, sans-serif;
	font-size: 30px;
	font-weight: 700;
	letter-spacing: 0.02em;
	box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
	text-align: center;
}

#${OVERLAY_ID} .blossom-lock-time {
	display: block;
	margin-top: 10px;
	font-size: 22px;
	font-weight: 600;
	letter-spacing: 0;
}
`;

	(document.head || document.documentElement).appendChild(style);
}

function ensureLockOverlay() {
	let overlay = document.getElementById(OVERLAY_ID);
	if (overlay) {
		return overlay;
	}

	overlay = document.createElement('div');
	overlay.id = OVERLAY_ID;
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');

	const modal = document.createElement('div');
	modal.className = 'blossom-lock-modal';
	modal.innerHTML = `<div>${LOCK_MESSAGE}</div><span class="blossom-lock-time">Focused for 00:00</span>`;
	overlay.appendChild(modal);

	(document.body || document.documentElement).appendChild(overlay);
	return overlay;
}

function getFocusedSeconds(timerState) {
	if (!timerState) {
		return 0;
	}

	if (timerState.isRunning && timerState.startTimestampMs) {
		return Math.max(0, Math.floor((Date.now() - timerState.startTimestampMs) / 1000));
	}

	return Math.max(0, Math.floor((timerState.elapsedMs || 0) / 1000));
}

function formatElapsed(totalSeconds) {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateLockOverlayMessage(timerState) {
	const overlay = ensureLockOverlay();
	const timeNode = overlay.querySelector('.blossom-lock-time');
	if (!timeNode) {
		return;
	}

	timeNode.textContent = `Focused for ${formatElapsed(getFocusedSeconds(timerState))}`;
}

function applyLock(timerState) {
	updateLockOverlayMessage(timerState);

	if (isLockApplied) {
		// Re-attach if page scripts replace body while lock is active.
		if (!document.getElementById(OVERLAY_ID)) {
			updateLockOverlayMessage(timerState);
		}
		return;
	}

	ensureLockStyle();
	updateLockOverlayMessage(timerState);
	document.documentElement.classList.add(LOCK_CLASS_NAME);
	isLockApplied = true;
}

function removeLock() {
	if (!isLockApplied) {
		return;
	}

	document.documentElement.classList.remove(LOCK_CLASS_NAME);
	const overlay = document.getElementById(OVERLAY_ID);
	if (overlay) {
		overlay.remove();
	}

	isLockApplied = false;
}

function isTimerRunning(timerState) {
	return Boolean(timerState && timerState.isRunning);
}

function shouldLockCurrentPage(timerState, blockedDomains) {
	if (!isTimerRunning(timerState)) {
		return false;
	}

	const hostname = normalizeDomain(window.location.hostname);
	if (!hostname) {
		return false;
	}

	const domainList = Array.isArray(blockedDomains)
		? blockedDomains.map((entry) => normalizeDomain(entry)).filter(Boolean)
		: [];

	return domainList.some((blockedDomain) => domainMatches(hostname, blockedDomain));
}

async function syncLockState() {
	try {
		const data = await getStorageLocal([TIMER_STORAGE_KEY, BLOCKED_DOMAINS_KEY]);
		const lockPage = shouldLockCurrentPage(data[TIMER_STORAGE_KEY], data[BLOCKED_DOMAINS_KEY]);

		if (lockPage) {
			applyLock(data[TIMER_STORAGE_KEY]);
			return;
		}

		removeLock();
	} catch (_error) {
		removeLock();
	}
}

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'local') {
		return;
	}

	if (!changes[TIMER_STORAGE_KEY] && !changes[BLOCKED_DOMAINS_KEY]) {
		return;
	}

	syncLockState();
});

// Poll handles SPA navigation and runtime domain-list changes robustly.
window.setInterval(syncLockState, 1000);

syncLockState();
