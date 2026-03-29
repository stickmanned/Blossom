'use strict';

import './popup.css';

const timerButton = document.getElementById('timerButton');
const timerDisplay = document.getElementById('timerDisplay');
const coinButton = document.getElementById('coinButton');
const coinCountDisplay = document.querySelector('.coin-button__count');
const settingsButton = document.getElementById('settingsButton');
const domainsPane = document.getElementById('domainsPane');
const domainForm = document.getElementById('domainForm');
const domainInput = document.getElementById('domainInput');
const domainsList = document.getElementById('domainsList');
const shopPane = document.getElementById('shopPane');
const shopItems = document.getElementById('shopItems');
const shopStatus = document.getElementById('shopStatus');
const gardenPlot = document.getElementById('gardenPlot');
const gardenWorld = document.getElementById('gardenWorld');
const gardenTrees = document.getElementById('gardenTrees');
const treeTypeSelect = document.getElementById('treeTypeSelect');
const plantingHint = document.getElementById('plantingHint');
const gardenStatus = document.getElementById('gardenStatus');

const BLOCKED_DOMAINS_KEY = 'blockedDomains';
const GARDEN_TILE_SIZE_PX = 120;
const GARDEN_WORLD_TILES_X = 6;
const GARDEN_WORLD_TILES_Y = 6;
const GARDEN_WORLD_WIDTH_PX = GARDEN_TILE_SIZE_PX * GARDEN_WORLD_TILES_X;
const GARDEN_WORLD_HEIGHT_PX = GARDEN_TILE_SIZE_PX * GARDEN_WORLD_TILES_Y;

const TREE_DEFINITIONS = {
	blossom: {
		label: 'Blossom',
		stages: [
			{ threshold: 0, image: 'blossom stages/blossom 1.png' },
			{ threshold: 12, image: 'blossom stages/blossom 2.png' },
			{ threshold: 30, image: 'blossom stages/blossom 3.png' },
			{ threshold: 60, image: 'blossom stages/blossom 4.png' },
			{ threshold: 90, image: 'blossom stages/blossom 5.png' }
		]
	},
	glowberry: {
		label: 'Glowberry',
		stages: [
			{ threshold: 0, image: 'glowberry tree/glow 1.png' },
			{ threshold: 18, image: 'glowberry tree/glow 2.png' },
			{ threshold: 42, image: 'glowberry tree/glow 3.png' },
			{ threshold: 72, image: 'glowberry tree/glow 4.png' }
		]
	},
	fire: {
		label: 'Fire',
		stages: [
			{ threshold: 0, image: 'fire tree/fire 1.png' },
			{ threshold: 24, image: 'fire tree/fire 2.png' },
			{ threshold: 60, image: 'fire tree/fire 3.png' }
		]
	}
};

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
let isAwaitingPlant = false;

let shouldPlayContinuousCoinSound = false;
let continuousCoinAudio = null;
let coinSoundRunId = 0;
let coinSoundRetryTimeoutId = null;

let gardenViewOffsetX = 0;
let gardenViewOffsetY = 0;
let isDraggingGarden = false;
let dragStartClientX = 0;
let dragStartClientY = 0;
let dragStartOffsetX = 0;
let dragStartOffsetY = 0;
let dragDistancePx = 0;
let suppressNextPlotClick = false;

let blockedDomains = [];
let gardenState = {
	points: 0,
	totalFocusedSeconds: 0,
	treeInventory: {
		glowberry: 0,
		fire: 0
	},
	plantedTrees: [],
	treeCatalog: []
};

function formatElapsed(totalSeconds) {
	const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
	const minutes = Math.floor(safeSeconds / 60);
	const seconds = safeSeconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function applyGardenPlotTexture() {
	if (!gardenWorld) {
		return;
	}

	gardenWorld.style.backgroundImage = `url("${chrome.runtime.getURL('garden plot.png')}")`;
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function getPanBounds() {
	if (!gardenPlot) {
		return {
			maxX: 0,
			maxY: 0
		};
	}

	const maxX = Math.max(0, GARDEN_WORLD_WIDTH_PX - gardenPlot.clientWidth);
	const maxY = Math.max(0, GARDEN_WORLD_HEIGHT_PX - gardenPlot.clientHeight);

	return { maxX, maxY };
}

function applyGardenTransform() {
	if (!gardenWorld) {
		return;
	}

	gardenWorld.style.transform = `translate(${-gardenViewOffsetX}px, ${-gardenViewOffsetY}px)`;
}

function recenterGardenViewport() {
	const bounds = getPanBounds();
	gardenViewOffsetX = Math.floor(bounds.maxX / 2);
	gardenViewOffsetY = Math.floor(bounds.maxY / 2);
	applyGardenTransform();
}

function setGardenViewOffset(nextX, nextY) {
	const bounds = getPanBounds();
	gardenViewOffsetX = clamp(nextX, 0, bounds.maxX);
	gardenViewOffsetY = clamp(nextY, 0, bounds.maxY);
	applyGardenTransform();
}

function sleep(ms) {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

function getRunningElapsedSeconds() {
	if (!lastKnownState || !lastKnownState.isRunning || !lastKnownState.startTimestampMs) {
		return 0;
	}

	return Math.floor(Math.max(0, Date.now() - lastKnownState.startTimestampMs) / 1000);
}

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

function setStorageLocal(items) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.set(items, () => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
				return;
			}

			resolve();
		});
	});
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

function normalizeDomain(input) {
	const trimmed = String(input || '').trim().toLowerCase();
	if (!trimmed) {
		return '';
	}

	const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;

	try {
		const parsed = new URL(candidate);
		return parsed.hostname.replace(/^www\./, '');
	} catch (_error) {
		return '';
	}
}

function renderBlockedDomains() {
	if (!domainsList) {
		return;
	}

	domainsList.textContent = '';

	if (blockedDomains.length === 0) {
		const emptyItem = document.createElement('li');
		emptyItem.className = 'domains-pane__empty';
		emptyItem.textContent = 'No blocked domains yet.';
		domainsList.appendChild(emptyItem);
		return;
	}

	blockedDomains.forEach((domain) => {
		const item = document.createElement('li');
		item.className = 'domains-pane__item';

		const label = document.createElement('span');
		label.textContent = domain;

		const removeButton = document.createElement('button');
		removeButton.type = 'button';
		removeButton.className = 'domains-pane__remove';
		removeButton.textContent = 'Remove';
		removeButton.dataset.domain = domain;

		item.appendChild(label);
		item.appendChild(removeButton);
		domainsList.appendChild(item);
	});
}

async function loadBlockedDomains() {
	try {
		const result = await getStorageLocal([BLOCKED_DOMAINS_KEY]);
		const storedDomains = Array.isArray(result[BLOCKED_DOMAINS_KEY]) ? result[BLOCKED_DOMAINS_KEY] : [];
		blockedDomains = storedDomains
			.map((entry) => normalizeDomain(entry))
			.filter(Boolean)
			.filter((entry, index, all) => all.indexOf(entry) === index)
			.sort();
		renderBlockedDomains();
	} catch (_error) {
		blockedDomains = [];
		renderBlockedDomains();
	}
}

async function persistBlockedDomains() {
	await setStorageLocal({ [BLOCKED_DOMAINS_KEY]: blockedDomains });
}

async function addBlockedDomain(rawInput) {
	const normalized = normalizeDomain(rawInput);
	if (!normalized || blockedDomains.includes(normalized)) {
		return;
	}

	blockedDomains = [...blockedDomains, normalized].sort();
	renderBlockedDomains();
	await persistBlockedDomains();
}

async function removeBlockedDomain(domain) {
	if (!domain) {
		return;
	}

	blockedDomains = blockedDomains.filter((entry) => entry !== domain);
	renderBlockedDomains();
	await persistBlockedDomains();
}

function closeDomainsPane() {
	if (!domainsPane || !settingsButton) {
		return;
	}

	domainsPane.classList.remove('is-open');
	domainsPane.setAttribute('hidden', '');
	settingsButton.setAttribute('aria-expanded', 'false');
}

function setShopPaneOpen(shouldOpen) {
	if (!shopPane || !coinButton) {
		return;
	}

	if (shouldOpen) {
		shopPane.removeAttribute('hidden');
		coinButton.setAttribute('aria-expanded', 'true');
		closeDomainsPane();
		return;
	}

	shopPane.setAttribute('hidden', '');
	coinButton.setAttribute('aria-expanded', 'false');
}

function updatePointsDisplay(pointsValue) {
	if (!coinCountDisplay) {
		return;
	}

	coinCountDisplay.textContent = String(Math.max(0, Math.floor(pointsValue || 0)));
}

function getStageImageForTree(tree, elapsedSeconds) {
	const definition = TREE_DEFINITIONS[tree.type] || TREE_DEFINITIONS.blossom;
	let imagePath = definition.stages[0].image;

	for (let index = 0; index < definition.stages.length; index += 1) {
		if (elapsedSeconds >= definition.stages[index].threshold) {
			imagePath = definition.stages[index].image;
		}
	}

	return imagePath;
}

function getElapsedForTree(tree) {
	if (tree.finalElapsedSeconds !== null && tree.finalElapsedSeconds !== undefined) {
		return Math.max(0, Math.floor(tree.finalElapsedSeconds));
	}

	if (lastKnownState && lastKnownState.isRunning && lastKnownState.activeTreeId === tree.id) {
		return getRunningElapsedSeconds();
	}

	return 0;
}

function renderTreeSelect() {
	if (!treeTypeSelect) {
		return;
	}

	const availableTypes = ['blossom'];
	if ((gardenState.treeInventory?.glowberry || 0) > 0) {
		availableTypes.push('glowberry');
	}
	if ((gardenState.treeInventory?.fire || 0) > 0) {
		availableTypes.push('fire');
	}

	const selectedType = treeTypeSelect.value;

	treeTypeSelect.textContent = '';
	availableTypes.forEach((treeType) => {
		const option = document.createElement('option');
		option.value = treeType;
		const countLabel = treeType === 'blossom' ? '' : ` x${gardenState.treeInventory?.[treeType] || 0}`;
		option.textContent = `${TREE_DEFINITIONS[treeType]?.label || treeType}${countLabel}`;
		treeTypeSelect.appendChild(option);
	});

	if (availableTypes.includes(selectedType)) {
		treeTypeSelect.value = selectedType;
	} else {
		treeTypeSelect.value = 'blossom';
	}
}

function renderGardenTrees() {
	if (!gardenTrees) {
		return;
	}

	gardenTrees.textContent = '';

	const trees = Array.isArray(gardenState.plantedTrees) ? gardenState.plantedTrees : [];
	trees.forEach((tree) => {
		const elapsed = getElapsedForTree(tree);
		const imagePath = getStageImageForTree(tree, elapsed);
		const image = document.createElement('img');
		image.className = 'garden__tree-instance';
		if (lastKnownState?.isRunning && lastKnownState.activeTreeId === tree.id) {
			image.classList.add('is-active');
		}

		image.src = imagePath;
		image.alt = `${TREE_DEFINITIONS[tree.type]?.label || 'Tree'} tree`;
		image.style.left = `${tree.x}%`;
		image.style.top = `${tree.y}%`;
		gardenTrees.appendChild(image);
	});
}

function renderGardenStatus() {
	if (!gardenStatus) {
		return;
	}

	const focusedSeconds = Math.max(0, Math.floor(gardenState.totalFocusedSeconds + getRunningElapsedSeconds()));
	const treeCount = Array.isArray(gardenState.plantedTrees) ? gardenState.plantedTrees.length : 0;
	gardenStatus.textContent = `Focused ${formatElapsed(focusedSeconds)} | Trees planted: ${treeCount}`;
}

function renderPlantingHint(message) {
	if (!plantingHint) {
		return;
	}

	plantingHint.textContent = message;
}

function renderShopState(statusMessage = '') {
	if (!shopItems) {
		return;
	}

	shopItems.textContent = '';
	const catalog = Array.isArray(gardenState.treeCatalog) ? gardenState.treeCatalog : [];
	catalog.forEach((item) => {
		if (item.type === 'blossom') {
			return;
		}

		const row = document.createElement('div');
		const ownedCount = Number(item.ownedCount || 0);
		row.className = `shop-pane__item${ownedCount > 0 ? ' is-unlocked' : ''}`;

		const info = document.createElement('div');
		const name = document.createElement('p');
		name.className = 'shop-pane__item-name';
		name.textContent = item.label;
		const desc = document.createElement('p');
		desc.className = 'shop-pane__item-desc';
		desc.textContent = `Cost: ${item.cost} coins | Owned: ${ownedCount}`;

		info.appendChild(name);
		info.appendChild(desc);

		const action = document.createElement('button');
		action.type = 'button';
		action.className = 'shop-pane__buy';
		action.dataset.treeType = item.type;
		action.textContent = `Buy (${item.cost})`;
		action.disabled = !item.canBuy;

		row.appendChild(info);
		row.appendChild(action);
		shopItems.appendChild(row);
	});

	if (shopStatus) {
		shopStatus.textContent = statusMessage || `Coins: ${gardenState.points}`;
	}
}

function renderGarden() {
	updatePointsDisplay(gardenState.points);
	renderTreeSelect();
	renderGardenTrees();
	renderGardenStatus();
	renderShopState();
}

function mergeGardenStateFromResponse(state) {
	gardenState = {
		...gardenState,
		points: Math.max(0, Math.floor(state.points || 0)),
		totalFocusedSeconds: Math.max(0, Math.floor(state.totalFocusedSeconds || 0)),
		treeInventory: {
			...gardenState.treeInventory,
			...(state.treeInventory || {})
		},
		plantedTrees: Array.isArray(state.plantedTrees) ? state.plantedTrees : gardenState.plantedTrees,
		treeCatalog: Array.isArray(state.treeCatalog) ? state.treeCatalog : gardenState.treeCatalog
	};

	renderGarden();
}

function startPlantingMode() {
	if (!gardenPlot || !treeTypeSelect) {
		return;
	}

	isAwaitingPlant = true;
	gardenPlot.classList.add('is-planting');
	renderPlantingHint(`Planting ${TREE_DEFINITIONS[treeTypeSelect.value]?.label || 'tree'}: click anywhere on the plot.`);

	if (timerButton) {
		timerButton.textContent = 'Click to cancel planting';
	}

	setShopPaneOpen(false);
	closeDomainsPane();
}

function cancelPlantingMode() {
	isAwaitingPlant = false;
	if (gardenPlot) {
		gardenPlot.classList.remove('is-planting');
		gardenPlot.classList.remove('is-dragging');
	}

	renderPlantingHint('Click start timer, then click the plot to plant.');

	if (!timerButton) {
		return;
	}

	if (lastKnownState?.isRunning) {
		timerButton.textContent = 'Click to stop timer';
		return;
	}

	timerButton.textContent = 'Click to start timer';
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
	}

	coinSoundRunId += 1;
	const activeRunId = coinSoundRunId;

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

	playContinuousCoinTick(activeRunId);
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

	if (timerDisplay) {
		timerDisplay.textContent = formatElapsed(getElapsedSeconds(state));
	}

	if (timerButton) {
		if (state.isRunning) {
			timerButton.textContent = 'Click to stop timer';
		} else if (isAwaitingPlant) {
			timerButton.textContent = 'Click to cancel planting';
		} else {
			timerButton.textContent = 'Click to start timer';
		}
	}

	mergeGardenStateFromResponse(state);
}

function startUiTicker() {
	if (uiIntervalId !== null) {
		window.clearInterval(uiIntervalId);
	}

	uiIntervalId = window.setInterval(() => {
		if (!lastKnownState || !lastKnownState.isRunning) {
			return;
		}

		if (timerDisplay) {
			timerDisplay.textContent = formatElapsed(getElapsedSeconds(lastKnownState));
		}

		renderGardenStatus();
		renderGardenTrees();
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
	return state;
}

async function refreshGardenState() {
	const state = await sendRuntimeMessage({ type: 'GARDEN_GET_STATE' });
	mergeGardenStateFromResponse(state);
	return state;
}

async function animateStopConversion(state) {
	const earnedElapsedMs = Math.max(0, Math.floor(state.earnedElapsedMs || 0));
	const earnedPoints = Math.max(0, Math.floor(state.earnedPoints || 0));
	const finalPoints = Math.max(0, Math.floor(state.points || 0));
	const startingPoints = Math.max(0, finalPoints - earnedPoints);

	updatePointsDisplay(startingPoints);
	if (timerButton) {
		timerButton.textContent = 'Click to start timer';
	}

	const totalSteps = Math.max(1, earnedPoints, Math.floor(earnedElapsedMs / 1000));
	const delayPerStepMs = Math.max(50, Math.min(180, Math.floor(4000 / totalSteps)));

	if (earnedPoints > 0) {
		startContinuousCoinSound();
	}

	try {
		for (let step = 1; step <= totalSteps; step += 1) {
			const consumedMs = Math.floor((earnedElapsedMs * step) / totalSteps);
			const remainingMs = Math.max(0, earnedElapsedMs - consumedMs);
			if (timerDisplay) {
				timerDisplay.textContent = formatElapsed(Math.floor(remainingMs / 1000));
			}

			const appliedPoints = Math.floor((earnedPoints * step) / totalSteps);
			updatePointsDisplay(startingPoints + appliedPoints);

			await sleep(delayPerStepMs);
		}
	} finally {
		stopContinuousCoinSound();
	}

	if (timerDisplay) {
		timerDisplay.textContent = formatElapsed(0);
	}
	updatePointsDisplay(finalPoints);
}

async function stopFocusSession() {
	const state = await sendRuntimeMessage({ type: 'TIMER_TOGGLE' });

	const shouldAnimateStop =
		lastKnownState?.isRunning &&
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
	await refreshGardenState().catch(() => {});
}

async function startFocusSessionFromPlanting(xPercent, yPercent) {
	const selectedType = treeTypeSelect?.value || 'blossom';
	const state = await sendRuntimeMessage({
		type: 'TIMER_TOGGLE',
		planting: {
			type: selectedType,
			x: xPercent,
			y: yPercent
		}
	});

	cancelPlantingMode();
	renderFromState(state);
	syncUiTickerWithState(state);
}

function setupShopPane() {
	if (!coinButton || !shopPane || !shopItems) {
		return;
	}

	setShopPaneOpen(false);
	renderShopState();

	coinButton.addEventListener('click', () => {
		const isHidden = shopPane.hasAttribute('hidden');
		setShopPaneOpen(isHidden);
	});

	shopItems.addEventListener('click', async (event) => {
		const target = event.target;
		if (!(target instanceof HTMLButtonElement)) {
			return;
		}

		const treeType = target.dataset.treeType;
		if (!treeType) {
			return;
		}

		target.disabled = true;
		try {
			const response = await sendRuntimeMessage({ type: 'GARDEN_BUY_TREE', treeType });
			mergeGardenStateFromResponse(response);
			renderShopState(response.errorCode === 'INSUFFICIENT_POINTS' ? 'Not enough coins.' : 'Tree purchased.');
		} catch (_error) {
			renderShopState('Could not complete purchase.');
		}
	});
}

function setupBlockedDomainsPane() {
	if (!settingsButton || !domainsPane || !domainForm || !domainInput || !domainsList) {
		return;
	}

	domainsPane.classList.remove('is-open');
	domainsPane.setAttribute('hidden', '');
	settingsButton.setAttribute('aria-expanded', 'false');

	settingsButton.addEventListener('click', () => {
		const isOpen = domainsPane.classList.contains('is-open');
		if (!isOpen) {
			domainsPane.classList.add('is-open');
			domainsPane.removeAttribute('hidden');
			settingsButton.setAttribute('aria-expanded', 'true');
			setShopPaneOpen(false);
			domainInput.focus();
			return;
		}

		closeDomainsPane();
	});

	domainForm.addEventListener('submit', async (event) => {
		event.preventDefault();
		await addBlockedDomain(domainInput.value);
		domainInput.value = '';
		domainInput.focus();
	});

	domainsList.addEventListener('click', async (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		if (!target.classList.contains('domains-pane__remove')) {
			return;
		}

		await removeBlockedDomain(target.dataset.domain || '');
	});

	loadBlockedDomains();
}

function setupPlantingFlow() {
	if (!gardenPlot || !timerButton) {
		return;
	}

	const stopDragging = () => {
		if (!isDraggingGarden) {
			return;
		}

		isDraggingGarden = false;
		gardenPlot.classList.remove('is-dragging');
	};

	gardenPlot.addEventListener('mousedown', (event) => {
		if (event.button !== 0) {
			return;
		}

		isDraggingGarden = true;
		dragStartClientX = event.clientX;
		dragStartClientY = event.clientY;
		dragStartOffsetX = gardenViewOffsetX;
		dragStartOffsetY = gardenViewOffsetY;
		dragDistancePx = 0;
		gardenPlot.classList.add('is-dragging');
	});

	window.addEventListener('mousemove', (event) => {
		if (!isDraggingGarden) {
			return;
		}

		const deltaX = event.clientX - dragStartClientX;
		const deltaY = event.clientY - dragStartClientY;
		dragDistancePx = Math.max(dragDistancePx, Math.abs(deltaX), Math.abs(deltaY));

		setGardenViewOffset(dragStartOffsetX - deltaX, dragStartOffsetY - deltaY);
	});

	window.addEventListener('mouseup', () => {
		if (!isDraggingGarden) {
			return;
		}

		if (dragDistancePx > 4) {
			suppressNextPlotClick = true;
		}

		stopDragging();
	});

	window.addEventListener('mouseleave', stopDragging);

	gardenPlot.addEventListener('click', async (event) => {
		if (suppressNextPlotClick) {
			suppressNextPlotClick = false;
			return;
		}

		if (!isAwaitingPlant || lastKnownState?.isRunning || isToggling) {
			return;
		}

		const rect = gardenPlot.getBoundingClientRect();
		const viewportX = clamp(event.clientX - rect.left, 0, rect.width);
		const viewportY = clamp(event.clientY - rect.top, 0, rect.height);
		const worldX = viewportX + gardenViewOffsetX;
		const worldY = viewportY + gardenViewOffsetY;
		const xPercent = (worldX / GARDEN_WORLD_WIDTH_PX) * 100;
		const yPercent = (worldY / GARDEN_WORLD_HEIGHT_PX) * 100;

		isToggling = true;
		try {
			await startFocusSessionFromPlanting(xPercent, yPercent);
		} catch (_error) {
			renderPlantingHint('Could not plant tree. Please try again.');
		} finally {
			isToggling = false;
		}
	});

	timerButton.addEventListener('click', async () => {
		if (isToggling || isAnimatingStop) {
			return;
		}

		if (lastKnownState?.isRunning) {
			isToggling = true;
			try {
				await stopFocusSession();
			} catch (_error) {
				await refreshState().catch(() => {
					if (timerDisplay) {
						timerDisplay.textContent = formatElapsed(0);
					}
					timerButton.textContent = 'Click to start timer';
				});
			} finally {
				isToggling = false;
			}
			return;
		}

		if (isAwaitingPlant) {
			cancelPlantingMode();
			return;
		}

		startPlantingMode();
	});
}

setupBlockedDomainsPane();
setupShopPane();
setupPlantingFlow();
applyGardenPlotTexture();
recenterGardenViewport();

refreshState()
	.then(() => refreshGardenState())
	.catch(() => {
		if (timerDisplay) {
			timerDisplay.textContent = formatElapsed(0);
		}
		if (timerButton) {
			timerButton.textContent = 'Click to start timer';
		}
		renderGarden();
	});

cancelPlantingMode();
