'use strict';

// With background scripts you can communicate with popup
// and contentScript files.
// For more information on background script,
// See https://developer.chrome.com/extensions/background_pages

const TIMER_STORAGE_KEY = 'timerState';
const CURRENCY_STORAGE_KEY = 'currencyState';
const FOCUS_STATS_STORAGE_KEY = 'focusStats';
const GARDEN_STORAGE_KEY = 'gardenState';

// Testing default: 1 point per second. Change this to tune conversion later.
const MS_PER_POINT = 1000;

const TREE_DEFINITIONS = {
	blossom: {
		label: 'Blossom',
		cost: 0,
		pointsPerInterval: 1
	},
	glowberry: {
		label: 'Glowberry',
		cost: 600,
		pointsPerInterval: 10
	},
	fire: {
		label: 'Fire',
		cost: 100,
		pointsPerInterval: 5
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
		unlockedTreeTypes: ['blossom'],
		plantedTrees: [
			{
				id: 'starter-tree',
				type: 'blossom',
				x: 50,
				y: 84,
				finalElapsedSeconds: 0,
				createdAtMs: Date.now()
			}
		]
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

	return Math.max(6, Math.min(94, value));
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
	const unlockedFromStorage = Array.isArray(storedState.unlockedTreeTypes) ? storedState.unlockedTreeTypes : [];
	const unlocked = ['blossom', ...unlockedFromStorage.map((item) => sanitizeTreeType(item))]
		.filter((item, index, all) => all.indexOf(item) === index);

	const planted = Array.isArray(storedState.plantedTrees)
		? storedState.plantedTrees.map((tree, index) => sanitizeTreeEntry(tree, index))
		: [];

	return {
		...base,
		unlockedTreeTypes: unlocked,
		plantedTrees: planted.length > 0 ? planted : base.plantedTrees
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
					unlockedTreeTypes: sanitized.unlockedTreeTypes,
					plantedTrees: sanitized.plantedTrees
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

function createTreeCatalog(unlockedTreeTypes, points) {
	return Object.keys(TREE_DEFINITIONS).map((treeType) => ({
		type: treeType,
		label: TREE_DEFINITIONS[treeType].label,
		cost: TREE_DEFINITIONS[treeType].cost,
		isUnlocked: unlockedTreeTypes.includes(treeType),
		canBuy: !unlockedTreeTypes.includes(treeType) && points >= TREE_DEFINITIONS[treeType].cost
	}));
}

function toResponseState(timerState, currencyState, focusStats, gardenState) {
	const elapsedMs = getElapsedMs(timerState);
	const points = sanitizePoints(currencyState.totalPoints);
	const safeGarden = sanitizeGardenState(gardenState || {});

	return {
		...timerState,
		elapsedMs,
		elapsedSeconds: Math.floor(elapsedMs / 1000),
		points,
		msPerPoint: MS_PER_POINT,
		totalFocusedSeconds: sanitizeCount(focusStats.totalFocusedSeconds),
		unlockedTreeTypes: safeGarden.unlockedTreeTypes,
		plantedTrees: safeGarden.plantedTrees,
		treeCatalog: createTreeCatalog(safeGarden.unlockedTreeTypes, points),
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
	if (!currentGardenState.unlockedTreeTypes.includes(newTree.type)) {
		throw new Error('Selected tree type is locked');
	}

	const nextGarden = {
		...currentGardenState,
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

async function handleBuyTree(treeType) {
	const normalizedType = sanitizeTreeType(treeType);
	if (normalizedType === 'blossom') {
		return getGardenResponse();
	}

	const [currencyState, gardenState, timerState, focusStats] = await Promise.all([
		getStoredCurrencyState(),
		getStoredGardenState(),
		getStoredTimerState(),
		getStoredFocusStats()
	]);

	if (gardenState.unlockedTreeTypes.includes(normalizedType)) {
		return toResponseState(timerState, currencyState, focusStats, gardenState);
	}

	const cost = TREE_DEFINITIONS[normalizedType].cost;
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
		unlockedTreeTypes: [...gardenState.unlockedTreeTypes, normalizedType]
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
		handleBuyTree(message.treeType)
			.then((state) => {
				sendResponse({ ok: true, state });
			})
			.catch((error) => {
				sendResponse({ ok: false, error: error.message });
			});

		return true;
	}
});
