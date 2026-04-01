'use strict';

// With background scripts you can communicate with popup
// and contentScript files.
// For more information on background script,
// See https://developer.chrome.com/extensions/background_pages

const TIMER_STORAGE_KEY = 'timerState';
const CURRENCY_STORAGE_KEY = 'currencyState';
const FOCUS_STATS_STORAGE_KEY = 'focusStats';
const GARDEN_STORAGE_KEY = 'gardenState';

// Testing default: 1 point per minute. 
const MS_PER_POINT = 60000;

const GARDEN_TILE_SIZE_PX = 120;
const GARDEN_WORLD_TILES_X = 6;
const GARDEN_WORLD_TILES_Y = 6;

const TREE_DEFINITIONS = {
	blossom: {
		label: 'Blossom',
		description: 'A delicate starter tree that grows gently in the breeze. Your first companion.',
		cost: 0,
		pointsPerInterval: 1,
		growthTimeMin: 60
	},
	glowberry: {
		label: 'Glowberry',
		description: 'A radiant magical tree sprouting luminescent berries. High reward yields.',
		cost: 300,
		pointsPerInterval: 5,
		growthTimeMin: 300
	},
	fire: {
		label: 'Fire',
		description: 'A blazing tree hardened by magma. Burns brightly during focus sessions.',
		cost: 50,
		pointsPerInterval: 2,
		growthTimeMin: 120
	}
};

function getDefaultTimerState() {
	return {
		isRunning: false,
		startTimestampMs: null,
		elapsedMs: 0,
		activeTreeId: null
	};
}

function getDefaultCurrencyState() {
	return {
		totalPoints: 0
	};
}

function getDefaultFocusStats() {
	return {
		totalFocusedSeconds: 0
	};
}

function getDefaultGardenState() {
	return {
		treeInventory: {
			glowberry: 0,
			fire: 0
		},
		plantedTrees: [],
		gardenExpansions: 0
	};
}

function sanitizePoints(value) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.floor(value));
}

function sanitizeCount(value) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.floor(value));
}

function sanitizePercent(value, fallback) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}

	return Math.max(0, Math.min(100, value));
}

function sanitizeTreeType(value) {
	const candidate = String(value || '').trim().toLowerCase();
	if (!TREE_DEFINITIONS[candidate]) {
		return 'blossom';
	}

	return candidate;
}

function sanitizeTreeEntry(entry, index) {
	const tree = entry || {};
	return {
		id: typeof tree.id === 'string' && tree.id.trim() ? tree.id : `tree-${Date.now()}-${index}`,
		type: sanitizeTreeType(tree.type),
		x: sanitizePercent(tree.x, 50),
		y: sanitizePercent(tree.y, 84),
		finalElapsedSeconds:
			tree.finalElapsedSeconds === null || tree.finalElapsedSeconds === undefined
				? null
				: sanitizeCount(tree.finalElapsedSeconds),
		createdAtMs: sanitizeCount(tree.createdAtMs || Date.now())
	};
}

function sanitizeGardenState(storedState) {
	const base = getDefaultGardenState();
	const legacyUnlocked = Array.isArray(storedState.unlockedTreeTypes) ? storedState.unlockedTreeTypes : [];
	const legacyInventoryBoost = {
		glowberry: legacyUnlocked.includes('glowberry') ? 1 : 0,
		fire: legacyUnlocked.includes('fire') ? 1 : 0
	};
	const storedInventory = storedState.treeInventory || {};
	const treeInventory = {
		glowberry: Math.max(legacyInventoryBoost.glowberry, sanitizeCount(storedInventory.glowberry)),
		fire: Math.max(legacyInventoryBoost.fire, sanitizeCount(storedInventory.fire))
	};

	const planted = Array.isArray(storedState.plantedTrees)
		? storedState.plantedTrees.map((tree, index) => sanitizeTreeEntry(tree, index))
		: [];

	const gardenExpansions = Math.min(100, sanitizeCount(storedState.gardenExpansions || 0));

	return {
		...base,
		treeInventory,
		plantedTrees: planted.length > 0 ? planted : base.plantedTrees,
		gardenExpansions
	};
}

function getStoredTimerState() {
	return new Promise((resolve) => {
		chrome.storage.local.get([TIMER_STORAGE_KEY], (result) => {
			const storedState = result[TIMER_STORAGE_KEY] || {};
			resolve({
				...getDefaultTimerState(),
				...storedState,
				activeTreeId: typeof storedState.activeTreeId === 'string' ? storedState.activeTreeId : null
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

function getStoredFocusStats() {
	return new Promise((resolve) => {
		chrome.storage.local.get([FOCUS_STATS_STORAGE_KEY], (result) => {
			const storedState = result[FOCUS_STATS_STORAGE_KEY] || {};
			resolve({
				...getDefaultFocusStats(),
				totalFocusedSeconds: sanitizeCount(storedState.totalFocusedSeconds)
			});
		});
	});
}

function setStoredFocusStats(nextState) {
	return new Promise((resolve) => {
		chrome.storage.local.set(
			{ [FOCUS_STATS_STORAGE_KEY]: { totalFocusedSeconds: sanitizeCount(nextState.totalFocusedSeconds) } },
			() => {
				resolve();
			}
		);
	});
}

function getStoredGardenState() {
	return new Promise((resolve) => {
		chrome.storage.local.get([GARDEN_STORAGE_KEY], (result) => {
			const storedState = result[GARDEN_STORAGE_KEY] || {};
			resolve(sanitizeGardenState(storedState));
		});
	});
}

function setStoredGardenState(nextState) {
	return new Promise((resolve) => {
		const sanitized = sanitizeGardenState(nextState || {});
		chrome.storage.local.set(
			{
				[GARDEN_STORAGE_KEY]: {
					treeInventory: sanitized.treeInventory,
					plantedTrees: sanitized.plantedTrees,
					gardenExpansions: sanitized.gardenExpansions
				}
			},
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

function getRunningPoints(elapsedMs, treeType) {
	const intervals = Math.floor(Math.max(0, elapsedMs) / MS_PER_POINT);
	const safeTreeType = sanitizeTreeType(treeType);
	const pointsPerInterval = sanitizeCount(TREE_DEFINITIONS[safeTreeType].pointsPerInterval || 1);
	return intervals * pointsPerInterval;
}

function createTreeCatalog(treeInventory, points) {
	return Object.keys(TREE_DEFINITIONS).map((treeType) => ({
		type: treeType,
		label: TREE_DEFINITIONS[treeType].label,
		description: TREE_DEFINITIONS[treeType].description,
		cost: TREE_DEFINITIONS[treeType].cost,
		pointsPerInterval: TREE_DEFINITIONS[treeType].pointsPerInterval,
		growthTimeMin: TREE_DEFINITIONS[treeType].growthTimeMin,
		ownedCount: treeType === 'blossom' ? null : sanitizeCount(treeInventory[treeType]),
		canBuy: treeType !== 'blossom' && points >= TREE_DEFINITIONS[treeType].cost
	}));
}

function toResponseState(timerState, currencyState, focusStats, gardenState) {
	const elapsedMs = getElapsedMs(timerState);
	const points = sanitizePoints(currencyState.totalPoints);
	const safeGarden = sanitizeGardenState(gardenState || {});
	const expansions = safeGarden.gardenExpansions;
	const expandCost = expansions < 100 ? Math.floor(100 * Math.pow(2, expansions)) : null;

	return {
		...timerState,
		elapsedMs,
		elapsedSeconds: Math.floor(elapsedMs / 1000),
		points,
		msPerPoint: MS_PER_POINT,
		totalFocusedSeconds: sanitizeCount(focusStats.totalFocusedSeconds),
		treeInventory: safeGarden.treeInventory,
		plantedTrees: safeGarden.plantedTrees,
		treeCatalog: createTreeCatalog(safeGarden.treeInventory, points),
		gardenExpansions: expansions,
		gardenExpandCost: expandCost,
		earnedPoints: 0,
		earnedElapsedMs: 0
	};
}

function buildTreeFromPlanting(planting) {
	const treeType = sanitizeTreeType(planting?.type);
	const x = sanitizePercent(Number(planting?.x), 50);
	const y = sanitizePercent(Number(planting?.y), 84);
	const treeId = `tree-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

	return {
		id: treeId,
		type: treeType,
		x,
		y,
		finalElapsedSeconds: null,
		createdAtMs: Date.now()
	};
}

function finalizeActiveTree(gardenState, activeTreeId, elapsedSeconds) {
	const nextTrees = gardenState.plantedTrees.map((tree) => {
		if (tree.id !== activeTreeId) {
			return tree;
		}

		return {
			...tree,
			finalElapsedSeconds: sanitizeCount(elapsedSeconds)
		};
	});

	return {
		...gardenState,
		plantedTrees: nextTrees
	};
}

function getTreeTypeById(gardenState, treeId) {
	if (!treeId || !gardenState || !Array.isArray(gardenState.plantedTrees)) {
		return 'blossom';
	}

	const tree = gardenState.plantedTrees.find((entry) => entry.id === treeId);
	if (!tree) {
		return 'blossom';
	}

	return sanitizeTreeType(tree.type);
}

async function handleToggleTimer(planting) {
	const [currentTimer, currentCurrency, currentFocusStats, currentGardenState] = await Promise.all([
		getStoredTimerState(),
		getStoredCurrencyState(),
		getStoredFocusStats(),
		getStoredGardenState()
	]);

	if (currentTimer.isRunning) {
		const elapsedMs = getElapsedMs(currentTimer);
		const activeTreeType = getTreeTypeById(currentGardenState, currentTimer.activeTreeId);
		const earnedPoints = getRunningPoints(elapsedMs, activeTreeType);
		const earnedFocusedSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
		const nextCurrency = {
			totalPoints: sanitizePoints(currentCurrency.totalPoints) + earnedPoints
		};
		const nextFocusStats = {
			totalFocusedSeconds: sanitizeCount(currentFocusStats.totalFocusedSeconds) + earnedFocusedSeconds
		};
		const nextGarden = finalizeActiveTree(
			currentGardenState,
			currentTimer.activeTreeId,
			earnedFocusedSeconds
		);
		const stoppedState = {
			isRunning: false,
			startTimestampMs: null,
			elapsedMs: 0,
			activeTreeId: null
		};

		await Promise.all([
			setStoredTimerState(stoppedState),
			setStoredCurrencyState(nextCurrency),
			setStoredFocusStats(nextFocusStats),
			setStoredGardenState(nextGarden)
		]);

		return {
			...toResponseState(stoppedState, nextCurrency, nextFocusStats, nextGarden),
			earnedPoints,
			earnedElapsedMs: elapsedMs
		};
	}

	const newTree = buildTreeFromPlanting(planting);
	if (newTree.type !== 'blossom' && sanitizeCount(currentGardenState.treeInventory[newTree.type]) <= 0) {
		throw new Error('Selected tree type is not available');
	}

	const nextInventory = {
		...currentGardenState.treeInventory
	};
	if (newTree.type !== 'blossom') {
		nextInventory[newTree.type] = sanitizeCount(nextInventory[newTree.type]) - 1;
	}

	const nextGarden = {
		...currentGardenState,
		treeInventory: nextInventory,
		plantedTrees: [...currentGardenState.plantedTrees, newTree]
	};
	const startedState = {
		isRunning: true,
		startTimestampMs: Date.now(),
		elapsedMs: 0,
		activeTreeId: newTree.id
	};

	await Promise.all([
		setStoredGardenState(nextGarden),
		setStoredTimerState(startedState)
	]);

	return toResponseState(startedState, currentCurrency, currentFocusStats, nextGarden);
}

async function getGardenResponse() {
	const [timerState, currencyState, focusStats, gardenState] = await Promise.all([
		getStoredTimerState(),
		getStoredCurrencyState(),
		getStoredFocusStats(),
		getStoredGardenState()
	]);

	return toResponseState(timerState, currencyState, focusStats, gardenState);
}

async function handleBuyTree(treeType, quantity = 1) {
	const normalizedType = sanitizeTreeType(treeType);
	if (normalizedType === 'blossom') {
		return getGardenResponse();
	}

	const qty = Math.max(1, sanitizeCount(quantity));

	const [currencyState, gardenState, timerState, focusStats] = await Promise.all([
		getStoredCurrencyState(),
		getStoredGardenState(),
		getStoredTimerState(),
		getStoredFocusStats()
	]);

	const cost = TREE_DEFINITIONS[normalizedType].cost * qty;
	const points = sanitizePoints(currencyState.totalPoints);
	if (points < cost) {
		return {
			...toResponseState(timerState, currencyState, focusStats, gardenState),
			errorCode: 'INSUFFICIENT_POINTS'
		};
	}

	const nextCurrency = { totalPoints: points - cost };
	const nextGarden = {
		...gardenState,
		treeInventory: {
			...gardenState.treeInventory,
			[normalizedType]: sanitizeCount(gardenState.treeInventory[normalizedType]) + qty
		}
	};

	await Promise.all([
		setStoredCurrencyState(nextCurrency),
		setStoredGardenState(nextGarden)
	]);

	return toResponseState(timerState, nextCurrency, focusStats, nextGarden);
}

async function handleExpandGarden() {
	const [currencyState, gardenState, timerState, focusStats] = await Promise.all([
		getStoredCurrencyState(),
		getStoredGardenState(),
		getStoredTimerState(),
		getStoredFocusStats()
	]);

	const expansions = sanitizeCount(gardenState.gardenExpansions || 0);
	if (expansions >= 100) {
		return {
			...toResponseState(timerState, currencyState, focusStats, gardenState),
			errorCode: 'MAX_EXPANSIONS'
		};
	}

	const cost = Math.floor(100 * Math.pow(2, expansions));
	const points = sanitizePoints(currencyState.totalPoints);
	if (points < cost) {
		return {
			...toResponseState(timerState, currencyState, focusStats, gardenState),
			errorCode: 'INSUFFICIENT_POINTS'
		};
	}

	const nextCurrency = { totalPoints: points - cost };

	const oldW = (GARDEN_WORLD_TILES_X + expansions * 2) * GARDEN_TILE_SIZE_PX;
	const oldH = (GARDEN_WORLD_TILES_Y + expansions * 2) * GARDEN_TILE_SIZE_PX;
	const newExpansions = expansions + 1;
	const newW = (GARDEN_WORLD_TILES_X + newExpansions * 2) * GARDEN_TILE_SIZE_PX;
	const newH = (GARDEN_WORLD_TILES_Y + newExpansions * 2) * GARDEN_TILE_SIZE_PX;
	const offset = GARDEN_TILE_SIZE_PX;

	const nextPlantedTrees = (gardenState.plantedTrees || []).map(tree => {
		const pixelX = (tree.x * oldW) / 100 + offset;
		const pixelY = (tree.y * oldH) / 100 + offset;
		return {
			...tree,
			x: (pixelX / newW) * 100,
			y: (pixelY / newH) * 100
		};
	});

	const nextGarden = { 
		...gardenState, 
		gardenExpansions: newExpansions,
		plantedTrees: nextPlantedTrees
	};

	await Promise.all([
		setStoredCurrencyState(nextCurrency),
		setStoredGardenState(nextGarden)
	]);

	return toResponseState(timerState, nextCurrency, focusStats, nextGarden);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || !message.type) {
		return;
	}

	if (message.type === 'DEV_SET_STATE') {
		(async () => {
			try {
				const [currencyState, timerState, focusStats, gardenState] = await Promise.all([
					getStoredCurrencyState(),
					getStoredTimerState(),
					getStoredFocusStats(),
					getStoredGardenState()
				]);

				const nextCurrency = { ...currencyState };
				const nextTimer = { ...timerState };
				const nextFocusStats = { ...focusStats };
				const nextGarden = { ...gardenState };

				if (typeof message.points === 'number') nextCurrency.totalPoints = message.points;
				
				if (typeof message.timerSeconds === 'number') {
					if (nextTimer.isRunning) {
						nextTimer.startTimestampMs = Date.now() - (message.timerSeconds * 1000);
					} else {
						nextTimer.elapsedMs = message.timerSeconds * 1000;
					}
				}

				await Promise.all([
					setStoredCurrencyState(nextCurrency),
					setStoredTimerState(nextTimer),
					setStoredFocusStats(nextFocusStats),
					setStoredGardenState(nextGarden)
				]);

				const response = toResponseState(nextTimer, nextCurrency, nextFocusStats, nextGarden);
				sendResponse({ ok: true, state: response });
			} catch (err) {
				sendResponse({ ok: false, error: err.message });
			}
		})();
		return true;
	}

	if (message.type === 'DEV_RESET_ALL') {
		(async () => {
			try {
				await new Promise((resolve) => chrome.storage.local.clear(resolve));
				const response = await getGardenResponse();
				sendResponse({ ok: true, state: response });
			} catch (err) {
				sendResponse({ ok: false, error: err.message });
			}
		})();
		return true;
	}

	if (message.type === 'TIMER_GET_STATE') {
		getGardenResponse()
			.then((state) => {
				sendResponse({ ok: true, state });
			})
			.catch((error) => {
				sendResponse({ ok: false, error: error.message });
			});

		return true;
	}

	if (message.type === 'TIMER_TOGGLE') {
		handleToggleTimer(message.planting)
			.then((state) => {
				sendResponse({ ok: true, state });
			})
			.catch((error) => {
				sendResponse({ ok: false, error: error.message });
			});

		return true;
	}

	if (message.type === 'GARDEN_GET_STATE') {
		getGardenResponse()
			.then((state) => {
				sendResponse({ ok: true, state });
			})
			.catch((error) => {
				sendResponse({ ok: false, error: error.message });
			});

		return true;
	}

	if (message.type === 'GARDEN_BUY_TREE') {
		handleBuyTree(message.treeType, message.quantity)
			.then((state) => {
				sendResponse({ ok: true, state });
			})
			.catch((error) => {
				sendResponse({ ok: false, error: error.message });
			});

		return true;
	}

	if (message.type === 'GARDEN_EXPAND') {
		handleExpandGarden()
			.then((state) => {
				sendResponse({ ok: true, state });
			})
			.catch((error) => {
				sendResponse({ ok: false, error: error.message });
			});

		return true;
	}
});
