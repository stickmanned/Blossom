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
const shopDetailSheet = document.getElementById('shopDetailSheet');
const shopDetailIcon = document.getElementById('shopDetailIcon');
const shopDetailName = document.getElementById('shopDetailName');
const shopDetailDesc = document.getElementById('shopDetailDesc');
const shopDetailStats = document.getElementById('shopDetailStats');
const shopDetailBuy = document.getElementById('shopDetailBuy');
const shopDetailClose = document.getElementById('shopDetailClose');
const shopDetailMinus = document.getElementById('shopDetailMinus');
const shopDetailPlus = document.getElementById('shopDetailPlus');
const shopDetailQty = document.getElementById('shopDetailQty');
const shopDetailMax = document.getElementById('shopDetailMax');
const shopDetailTotal = document.getElementById('shopDetailTotal');

let selectedShopItem = null;
let selectedShopQuantity = 1;

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

const TREE_DEFINITIONS = {
	blossom: {
		label: 'Blossom',
		growthTimeMin: 60,
		stages: [
			{ threshold: 0, image: 'blossom stages/blossom 1.png' },
			{ threshold: 900, image: 'blossom stages/blossom 2.png' },
			{ threshold: 1800, image: 'blossom stages/blossom 3.png' },
			{ threshold: 2700, image: 'blossom stages/blossom 4.png' },
			{ threshold: 3600, image: 'blossom stages/blossom 5.png' }
		]
	},
	glowberry: {
		label: 'Glowberry',
		growthTimeMin: 300,
		stages: [
			{ threshold: 0, image: 'glowberry tree/glow 1.png' },
			{ threshold: 6000, image: 'glowberry tree/glow 2.png' },
			{ threshold: 12000, image: 'glowberry tree/glow 3.png' },
			{ threshold: 18000, image: 'glowberry tree/glow 4.png' }
		]
	},
	fire: {
		label: 'Fire',
		growthTimeMin: 120,
		stages: [
			{ threshold: 0, image: 'fire tree/fire 1.png' },
			{ threshold: 3600, image: 'fire tree/fire 2.png' },
			{ threshold: 7200, image: 'fire tree/fire 3.png' }
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
let gardenZoomScale = 1.0;
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
	treeCatalog: [],
	gardenExpansions: 0,
	gardenExpandCost: 100
};

function formatElapsed(totalSeconds) {
	const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
	const minutes = Math.floor(safeSeconds / 60);
	const seconds = safeSeconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatCoins(num) {
	if (num >= 1000000000) return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
	if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
	if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
	return num.toString();
}

function applyGardenPlotTexture() {
	if (!gardenWorld) {
		return;
	}

	gardenWorld.style.backgroundImage = `url("${chrome.runtime.getURL('garden plot.png')}")`;
}

function getGardenWorldWidth() {
	const expansions = gardenState.gardenExpansions || 0;
	return GARDEN_TILE_SIZE_PX * (GARDEN_WORLD_TILES_X + expansions * 2);
}

function getGardenWorldHeight() {
	const expansions = gardenState.gardenExpansions || 0;
	return GARDEN_TILE_SIZE_PX * (GARDEN_WORLD_TILES_Y + expansions * 2);
}

function applyGardenWorldSize() {
	if (!gardenWorld) return;
	gardenWorld.style.width = `${getGardenWorldWidth()}px`;
	gardenWorld.style.height = `${getGardenWorldHeight()}px`;
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function getPanBounds() {
	if (!gardenPlot) {
		return { maxX: 0, maxY: 0 };
	}

	const scaledWidth = getGardenWorldWidth() * gardenZoomScale;
	const scaledHeight = getGardenWorldHeight() * gardenZoomScale;

	const maxX = Math.max(0, scaledWidth - gardenPlot.clientWidth);
	const maxY = Math.max(0, scaledHeight - gardenPlot.clientHeight);

	return { maxX, maxY };
}

function applyGardenTransform() {
	if (!gardenWorld) {
		return;
	}

	gardenWorld.style.transform = `translate(${-gardenViewOffsetX}px, ${-gardenViewOffsetY}px) scale(${gardenZoomScale})`;
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

		const left = document.createElement('div');
		left.className = 'domains-pane__item-left';

		const favicon = document.createElement('img');
		favicon.className = 'domains-pane__favicon';
		favicon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
		favicon.alt = '';
		favicon.width = 16;
		favicon.height = 16;

		const label = document.createElement('span');
		label.className = 'domains-pane__domain-label';
		label.textContent = domain;

		left.appendChild(favicon);
		left.appendChild(label);

		const removeButton = document.createElement('button');
		removeButton.type = 'button';
		removeButton.className = 'domains-pane__remove';
		removeButton.textContent = 'Remove';
		removeButton.dataset.domain = domain;

		item.appendChild(left);
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

	coinCountDisplay.textContent = formatCoins(Math.max(0, Math.floor(pointsValue || 0)));
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

function renderGardenTrees(newTreeId = null) {
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
		if (tree.id && tree.id === newTreeId) {
			image.classList.add('is-new');
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

function formatShopDetailStats(item) {
	// Fallback to local definitions if background data is stale
	const localDef = TREE_DEFINITIONS[item.type] || {};
	const ppi = item.pointsPerInterval || localDef.pointsPerInterval || 1;
	const growthMin = item.growthTimeMin || localDef.growthTimeMin || 60;

	// Format growth time: 1 hour for Blossom, else hours if >= 60
	const growthStr = growthMin === 60 ? '1 hour' : (growthMin >= 60 ? `${Math.floor(growthMin / 60)} hours` : `${growthMin} minutes`);

	return `${ppi} coin/min | Growth Time: ${growthStr}`;
}

function updateShopDetailTotal() {
	if (!selectedShopItem || !shopDetailTotal) return;

	let qty = parseInt(shopDetailQty?.value || '1', 10);
	if (isNaN(qty) || qty < 1) qty = 1;

	const costPerTree = selectedShopItem.cost || 1;
	const maxAffordable = Math.floor(gardenState.points / costPerTree);

	if (qty > maxAffordable && maxAffordable > 0) {
		qty = maxAffordable;
	} else if (maxAffordable === 0) {
		qty = 1;
	}

	selectedShopQuantity = qty;
	if (shopDetailQty) shopDetailQty.value = qty;

	const totalCost = costPerTree * selectedShopQuantity;

	if (costPerTree === 0) {
		shopDetailTotal.textContent = `Cost: Free`;
	} else {
		shopDetailTotal.textContent = `Cost: ${formatCoins(totalCost)} coins`;
	}

	if (shopDetailBuy) {
		let isBlossom = selectedShopItem.type === 'blossom';
		shopDetailBuy.disabled = gardenState.points < totalCost || !selectedShopItem.canBuy || isBlossom;
		shopDetailBuy.textContent = isBlossom ? 'Starter Tree' : 'Buy';
	}
}

function renderShopState(statusMessage = '') {
	if (!shopItems) {
		return;
	}

	shopItems.textContent = '';
	const catalog = Array.isArray(gardenState.treeCatalog) ? gardenState.treeCatalog : [];
	catalog.forEach((item) => {
		const ownedCount = Number(item.ownedCount || 0);
		const tile = document.createElement('button');
		tile.className = `shop-pane__tile${ownedCount > 0 ? ' is-unlocked' : ''}`;
		tile.type = 'button';
		tile.dataset.treeType = item.type;

		const img = document.createElement('img');
		img.className = 'shop-pane__tile-img';
		img.src = TREE_DEFINITIONS[item.type]?.stages.slice(-1)[0].image || '';
		img.alt = item.label;

		const name = document.createElement('span');
		name.className = 'shop-pane__tile-name';
		name.textContent = item.label;

		tile.appendChild(img);
		tile.appendChild(name);
		shopItems.appendChild(tile);
	});

	if (shopStatus) {
		shopStatus.textContent = statusMessage || `Coins: ${formatCoins(gardenState.points)}`;
	}

	if (selectedShopItem && shopDetailStats && shopDetailBuy) {
		const updatedItem = catalog.find((i) => i.type === selectedShopItem.type);
		if (updatedItem) {
			selectedShopItem = updatedItem;
			shopDetailStats.textContent = formatShopDetailStats(updatedItem);
			shopDetailBuy.disabled = !updatedItem.canBuy;
		}
	}
}

function renderGarden() {
	updatePointsDisplay(gardenState.points);
	renderTreeSelect();
	renderGardenTrees();
	renderGardenStatus();
	renderShopState();
}

function updateExpandBtn() {
	const expandGardenBtn = document.getElementById('expandGardenBtn');
	const expandGardenCost = document.getElementById('expandGardenCost');
	if (!expandGardenBtn) return;

	const expansions = gardenState.gardenExpansions || 0;
	const cost = gardenState.gardenExpandCost;

	if (expansions >= 100 || cost === null) {
		expandGardenBtn.disabled = true;
		if (expandGardenCost) expandGardenCost.textContent = 'MAX';
	} else {
		expandGardenBtn.disabled = (gardenState.points || 0) < cost;
		if (expandGardenCost) expandGardenCost.textContent = formatCoins(cost) + ' C';
	}
}

function mergeGardenStateFromResponse(state) {
	const oldExpansions = gardenState.gardenExpansions || 0;
	const newExpansions = typeof state.gardenExpansions === 'number' ? state.gardenExpansions : oldExpansions;

	// If expansion occurred, shift camera so tiles appear added on all sides evenly
	if (newExpansions > oldExpansions) {
		const diff = newExpansions - oldExpansions;
		gardenViewOffsetX += diff * GARDEN_TILE_SIZE_PX;
		gardenViewOffsetY += diff * GARDEN_TILE_SIZE_PX;
		applyGardenTransform();
	}

	gardenState = {
		...gardenState,
		points: Math.max(0, Math.floor(state.points || 0)),
		totalFocusedSeconds: Math.max(0, Math.floor(state.totalFocusedSeconds || 0)),
		treeInventory: {
			...gardenState.treeInventory,
			...(state.treeInventory || {})
		},
		plantedTrees: Array.isArray(state.plantedTrees) ? state.plantedTrees : gardenState.plantedTrees,
		treeCatalog: Array.isArray(state.treeCatalog) ? state.treeCatalog : gardenState.treeCatalog,
		gardenExpansions: newExpansions,
		gardenExpandCost: state.gardenExpandCost !== undefined ? state.gardenExpandCost : gardenState.gardenExpandCost
	};

	applyGardenWorldSize();
	updateExpandBtn();
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
	const index = Math.floor(Math.random() * 4) + 1;
	return `sounds/coins-${index}.wav`;
}

/** Plays a single random coin sound (for Buy / stop-timer completion). */
function playCoinSound() {
	try {
		const audio = new Audio(pickRandomCoinSoundPath());
		audio.volume = 0.65;
		audio.play().catch(() => { /* user gesture may not allow it */ });
	} catch (_e) { /* ignore */ }
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

	const earnedSeconds = Math.floor(earnedElapsedMs / 1000);
	const totalSteps = Math.min(60, Math.max(1, earnedSeconds, earnedPoints));

	let delayMs = 300; // Start pacing for animation
	const minDelayMs = 20; // Final speed

	if (earnedPoints > 0) {
		startContinuousCoinSound();
	}

	try {
		for (let step = 1; step <= totalSteps; step += 1) {
			// Delays accelerate from slow to fast
			delayMs = Math.max(minDelayMs, delayMs * 0.82);

			const progress = step / totalSteps;

			// Timer counts down based on total visual progress
			const consumedSeconds = Math.round(earnedSeconds * progress);
			const remainingSeconds = Math.max(0, earnedSeconds - consumedSeconds);
			if (timerDisplay) {
				timerDisplay.textContent = formatElapsed(remainingSeconds);
			}

			// Award coins based on total visual progress
			const appliedPoints = Math.round(earnedPoints * progress);
			updatePointsDisplay(startingPoints + appliedPoints);

			await sleep(delayMs);
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
	await refreshGardenState().catch(() => { });
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

	const hideSheet = () => {
		selectedShopItem = null;
		selectedShopQuantity = 1;
		if (shopDetailQty) shopDetailQty.value = '1';
		if (shopDetailSheet) shopDetailSheet.classList.add('is-hidden');
	};

	const expandGardenBtn = document.getElementById('expandGardenBtn');
	const expandGardenCost = document.getElementById('expandGardenCost');

	updateExpandBtn();

	if (expandGardenBtn) {
		expandGardenBtn.addEventListener('click', async () => {
			expandGardenBtn.disabled = true;
			try {
				const response = await sendRuntimeMessage({ type: 'GARDEN_EXPAND' });
				mergeGardenStateFromResponse(response);
				if (response.errorCode === 'INSUFFICIENT_POINTS') {
					renderShopState('Not enough coins to expand!');
				} else if (response.errorCode === 'MAX_EXPANSIONS') {
					renderShopState('Garden is at maximum size!');
				} else {
					playCoinSound();
					renderShopState(`Garden expanded! (${gardenState.gardenExpansions}/100)`);
				}
				updateExpandBtn();
			} catch (_e) {
				renderShopState('Could not expand garden.');
				updateExpandBtn();
			}
		});
	}

	coinButton.addEventListener('click', () => {
		const isHidden = shopPane.hasAttribute('hidden');
		setShopPaneOpen(isHidden);
		if (!isHidden) {
			hideSheet();
		}
	});

	if (shopDetailClose) {
		shopDetailClose.addEventListener('click', hideSheet);
	}

	if (shopDetailQty) {
		shopDetailQty.addEventListener('input', () => {
			updateShopDetailTotal();
		});
	}

	if (shopDetailMinus) {
		shopDetailMinus.addEventListener('click', () => {
			let val = parseInt(shopDetailQty?.value || '1', 10);
			if (isNaN(val)) val = 1;
			shopDetailQty.value = Math.max(1, val - 1);
			updateShopDetailTotal();
		});
	}

	if (shopDetailPlus) {
		shopDetailPlus.addEventListener('click', () => {
			let val = parseInt(shopDetailQty?.value || '1', 10);
			if (isNaN(val)) val = 1;
			shopDetailQty.value = val + 1;
			updateShopDetailTotal();
		});
	}

	if (shopDetailMax) {
		shopDetailMax.addEventListener('click', () => {
			if (!selectedShopItem) return;
			const maxAffordable = Math.floor(gardenState.points / (selectedShopItem.cost || 1));
			shopDetailQty.value = Math.max(1, maxAffordable);
			updateShopDetailTotal();
		});
	}

	shopItems.addEventListener('click', (event) => {
		const target = event.target.closest('.shop-pane__tile');
		if (!target) {
			return;
		}

		const treeType = target.dataset.treeType;
		const item = (gardenState.treeCatalog || []).find(i => i.type === treeType);
		if (!item || !shopDetailSheet) {
			return;
		}

		selectedShopItem = item;
		shopDetailIcon.src = TREE_DEFINITIONS[item.type]?.stages.slice(-1)[0].image || '';
		shopDetailName.textContent = item.label;
		if (shopDetailDesc) shopDetailDesc.textContent = item.description || '';
		shopDetailStats.textContent = formatShopDetailStats(item);

		// For Blossom (starter tree) hide purchase controls
		const purchaseArea = document.getElementById('shopDetailPurchaseArea');
		if (purchaseArea) {
			if (item.type === 'blossom') {
				purchaseArea.classList.add('is-hidden');
			} else {
				purchaseArea.classList.remove('is-hidden');
				selectedShopQuantity = 1;
				if (shopDetailQty) shopDetailQty.value = '1';
				updateShopDetailTotal();
			}
		}

		shopDetailSheet.classList.remove('is-hidden');
	});

	if (shopDetailBuy) {
		shopDetailBuy.addEventListener('click', async () => {
			if (!selectedShopItem) {
				return;
			}

			shopDetailBuy.disabled = true;
			try {
				const response = await sendRuntimeMessage({
					type: 'GARDEN_BUY_TREE',
					treeType: selectedShopItem.type,
					quantity: selectedShopQuantity
				});
				// Play a random coin sound on successful purchase
				playCoinSound();
				mergeGardenStateFromResponse(response);
				renderShopState(response.errorCode === 'INSUFFICIENT_POINTS' ? 'Not enough coins.' : 'Tree purchased.');
			} catch (_error) {
				renderShopState('Could not complete purchase.');
			}
		});
	}
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

	gardenPlot.addEventListener('wheel', (event) => {
		event.preventDefault();
		const oldScale = gardenZoomScale;

		// Greatly reduced sensitivity. Math.sign ensures consistent movement across
		// vastly different scroll-wheel deltas, scaling by 0.05 per tick.
		const zoomDelta = event.deltaY === 0 ? 0 : Math.sign(event.deltaY) * -0.05;
		gardenZoomScale = clamp(gardenZoomScale + zoomDelta, 0.5, 3.0);

		if (gardenZoomScale === oldScale) return;

		const rect = gardenPlot.getBoundingClientRect();
		const mouseX = clamp(event.clientX - rect.left, 0, rect.width);
		const mouseY = clamp(event.clientY - rect.top, 0, rect.height);

		const scaleRatio = gardenZoomScale / oldScale;
		gardenViewOffsetX = (gardenViewOffsetX + mouseX) * scaleRatio - mouseX;
		gardenViewOffsetY = (gardenViewOffsetY + mouseY) * scaleRatio - mouseY;

		setGardenViewOffset(gardenViewOffsetX, gardenViewOffsetY);
	});

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
		const worldX = (viewportX + gardenViewOffsetX) / gardenZoomScale;
		const worldY = (viewportY + gardenViewOffsetY) / gardenZoomScale;
		const xPercent = (worldX / getGardenWorldWidth()) * 100;
		const yPercent = (worldY / getGardenWorldHeight()) * 100;

		// Collision detection: use a fixed pixel distance (80px radius)
		// so spacing doesn't increase when the world expands.
		const MIN_DIST_PX = 80;
		const worldW = getGardenWorldWidth();
		const worldH = getGardenWorldHeight();
		const plantedTrees = Array.isArray(gardenState.plantedTrees) ? gardenState.plantedTrees : [];
		const tooClose = plantedTrees.some((tree) => {
			const dxPx = (tree.x - xPercent) * worldW / 100;
			const dyPx = (tree.y - yPercent) * worldH / 100;
			return Math.sqrt(dxPx * dxPx + dyPx * dyPx) < MIN_DIST_PX;
		});
		if (tooClose) {
			renderPlantingHint('Too close to another tree! Pick a different spot.');
			return;
		}

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

	// --- Developer Mode ("dev") ---
	let isHoveringTimer = false;
	let devKeyBuffer = "";
	const DEV_KEY = "dev";

	timerButton.addEventListener('mouseenter', () => {
		isHoveringTimer = true;
		devKeyBuffer = "";
	});

	timerButton.addEventListener('mouseleave', () => {
		isHoveringTimer = false;
	});

	window.addEventListener('keydown', (event) => {
		const panel = document.getElementById('devPanel');
		if (!isHoveringTimer || (panel && panel.classList.contains('is-open'))) return;

		devKeyBuffer += event.key;
		if (devKeyBuffer === DEV_KEY) {
			showDevPanel();
			devKeyBuffer = "";
		} else if (!DEV_KEY.startsWith(devKeyBuffer)) {
			devKeyBuffer = "";
		}
	});

	function showDevPanel() {
		const panel = document.getElementById('devPanel');
		if (panel) panel.classList.add('is-open');
	}

	const devClose = document.getElementById('devClose');
	const devPointsInput = document.getElementById('devPointsInput');
	const devTimeInput = document.getElementById('devTimeInput');
	const devApply = document.getElementById('devApply');

	if (devClose) devClose.addEventListener('click', () => {
		devKeyBuffer = "";
		document.getElementById('devPanel').classList.remove('is-open');
	});

	if (devApply) devApply.addEventListener('click', async () => {
		const points = parseInt(devPointsInput.value, 10);
		const timerSeconds = parseInt(devTimeInput.value, 10);

		const updateData = { type: 'DEV_SET_STATE' };
		if (!isNaN(points)) updateData.points = points;
		if (!isNaN(timerSeconds)) updateData.timerSeconds = timerSeconds;

		const response = await sendRuntimeMessage(updateData);
		if (response && response.ok && response.state) {
			const newState = response.state;
			updateTimerState(newState);
			updateTimerUIInterval(newState);
			updateGardenUI(newState);
		} else {
			console.error('Dev mode update failed:', response?.error || 'Unknown error');
		}

		devKeyBuffer = "";
		document.getElementById('devPanel').classList.remove('is-open');
	});

	const devReset = document.getElementById('devReset');
	if (devReset) devReset.addEventListener('click', async () => {
		const response = await sendRuntimeMessage({ type: 'DEV_RESET_ALL' });
		if (response && response.ok) {
			// Reloading the popup is the absolute most reliable way to reset internal variables
			window.location.reload();
		} else {
			console.error('Full reset failed:', response?.error || 'Unknown error');
		}
	});
}

setupBlockedDomainsPane();
setupShopPane();
setupPlantingFlow();
applyGardenPlotTexture();
applyGardenWorldSize();
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
