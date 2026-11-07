<template>
	<div class="flow-graph">
		<header v-if="title || $slots.actions" class="graph-header">
			<div class="graph-titles">
				<strong>{{ title }}</strong>
			</div>
			<div class="graph-actions"><slot name="actions" /></div>
		</header>

		<p v-if="!graph" class="muted">The flow this run belongs to no longer exists, so it can't be drawn.</p>
		<p v-else-if="!panels.length" class="muted">This flow has no steps.</p>

		<div v-else class="canvas-scroll">
			<div class="canvas" :style="{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }">
				<svg class="edges" :width="canvasWidth" :height="canvasHeight" aria-hidden="true">
					<defs>
						<marker id="arrow-resolve" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
							<path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="var(--theme--primary)" stroke-width="1.6" />
						</marker>
						<marker id="arrow-reject" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
							<path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="var(--theme--secondary)" stroke-width="1.6" />
						</marker>
					</defs>
					<path
						v-for="edge in edges"
						:key="edge.id"
						:d="edge.path"
						:class="['edge', edge.kind, { skipped: edge.skipped }]"
						:marker-end="`url(#arrow-${edge.kind})`"
						fill="none"
					/>
				</svg>

				<article
					v-for="panel in panels"
					:key="panel.id"
					class="card"
					:class="[{ trigger: panel.kind === 'trigger', changed: changedIds.includes(panel.id) }, `run-${stateOf(panel)}`]"
					:style="cardStyle(panel)"
					role="button"
					tabindex="0"
					:title="'Click to see what this step received and returned'"
					@click="emit('open', panel)"
					@keydown.enter.prevent="emit('open', panel)"
					@keydown.space.prevent="emit('open', panel)"
				>
					<span v-if="panel.kind !== 'trigger'" class="handle input"><span class="dot" /></span>

					<header class="card-title">
						<v-icon :name="titleIcon(panel)" small />
						<span class="card-name">{{ panel.kind === 'trigger' ? 'Trigger' : panel.name }}</span>
						<v-icon v-if="stateOf(panel) === 'resolve' && panel.kind !== 'trigger'" class="run-mark worked" name="check_circle" small />
						<v-icon v-else-if="stateOf(panel) === 'reject'" class="run-mark failed" name="cancel" small />
					</header>

					<div class="card-body">
						<p class="kind">{{ kindLabel(panel) }}</p>
						<p v-if="descriptionFor(panel)" class="description">{{ descriptionFor(panel) }}</p>

						<div v-if="rowsFor(panel).length" class="rows">
							<div v-for="row in rowsFor(panel)" :key="row.label" class="row">
								<div class="row-label">{{ row.label }}</div>
								<div class="row-value">{{ row.text }}</div>
							</div>
						</div>
					</div>

					<footer v-if="panel.kind === 'trigger' && panel.status" class="card-status" :class="panel.status">
						<span class="status-dot" />
						{{ statusLabel(panel.status) }}
					</footer>

					<template v-if="panel.kind !== 'trigger'">
						<span class="handle resolve" title="On success"><v-icon name="check" x-small /></span>
						<span class="handle reject" title="On failure"><v-icon name="close" x-small /></span>
					</template>
					<span v-else class="handle resolve" title="First step"><v-icon name="check" x-small /></span>
				</article>
			</div>
		</div>

	</div>
</template>

<script setup>
import { computed } from 'vue';
import { useExtensions, useStores } from '@directus/extensions-sdk';

const props = defineProps({
	graph: { type: Object, default: null },
	// What happened to each card in the run: { [cardId]: 'resolve' | 'reject' }. Cards missing from it did not run.
	states: { type: Object, default: () => ({}) },
	title: { type: String, default: '' },
	// A run with no saved step details: draw the flow without marking what ran.
	plain: { type: Boolean, default: false },
	// Cards whose data differs from the run being compared with.
	changedIds: { type: Array, default: () => [] },
});
const emit = defineEmits(['open']);

const stateOf = (panel) => (props.plain ? 'plain' : panel.kind === 'trigger' ? 'resolve' : (props.states[panel.id] ?? 'skipped'));

// Same grid as the Directus flow editor: 18px cells, cards 14 cells wide and tall.
const CELL = 18;
const WIDTH = 14;
const HEIGHT = 14;
const INPUT_Y = 3.4;
const RESOLVE_Y = 10;
const REJECT_Y = 12;

const extensions = useExtensions();
const { useCollectionsStore } = useStores();
const collectionsStore = useCollectionsStore();

const panels = computed(() => props.graph?.panels ?? []);

const operationDefinitions = computed(() => {
	const operations = extensions.operations?.value ?? extensions.operations ?? [];
	return new Map(operations.map((operation) => [operation.id, operation]));
});

const bounds = computed(() => {
	let maxX = 20;
	let maxY = 16;
	for (const panel of panels.value) {
		maxX = Math.max(maxX, (panel.x || 1) + WIDTH + 2);
		maxY = Math.max(maxY, (panel.y || 1) + HEIGHT + 2);
	}
	return { maxX, maxY };
});

const canvasWidth = computed(() => bounds.value.maxX * CELL);
const canvasHeight = computed(() => bounds.value.maxY * CELL);

const panelById = computed(() => new Map(panels.value.map((panel) => [panel.id, panel])));

const edges = computed(() => {
	const result = [];
	for (const panel of panels.value) {
		for (const kind of ['resolve', 'reject']) {
			const target = panel[kind] ? panelById.value.get(panel[kind]) : null;
			if (target) result.push({ ...makeEdge(panel, target, kind), skipped: stateOf(panel) === 'skipped' || stateOf(target) === 'skipped' });
		}
	}
	return result;
});

function cardStyle(panel) {
	return {
		left: `${(panel.x || 1) * CELL}px`,
		top: `${(panel.y || 1) * CELL}px`,
		width: `${WIDTH * CELL}px`,
		height: `${HEIGHT * CELL}px`,
	};
}

// Right-angled lines with rounded corners, like the flow editor: leave the step to the right, run
// around the cards, and enter the next step from the left.
function makeEdge(from, to, kind) {
	const handleY = kind === 'reject' ? REJECT_Y : RESOLVE_Y;
	const x1 = ((from.x || 1) + WIDTH) * CELL;
	const y1 = ((from.y || 1) + handleY) * CELL;
	const x2 = (to.x || 1) * CELL - 12;
	const y2 = ((to.y || 1) + INPUT_Y) * CELL;
	const lane = 2 * CELL;

	let points;
	if (x2 - lane >= x1 + CELL) {
		const midX = x2 - lane;
		points = [
			{ x: x1, y: y1 },
			{ x: midX, y: y1 },
			{ x: midX, y: y2 },
			{ x: x2, y: y2 },
		];
	} else {
		// The next step is to the left or directly below: go round underneath the source card.
		const belowY = ((from.y || 1) + HEIGHT + 1) * CELL;
		points = [
			{ x: x1, y: y1 },
			{ x: x1 + lane, y: y1 },
			{ x: x1 + lane, y: belowY },
			{ x: x2 - lane, y: belowY },
			{ x: x2 - lane, y: y2 },
			{ x: x2, y: y2 },
		];
	}

	return { id: `${from.id}:${kind}:${to.id}`, kind, path: roundedPath(points, 8) };
}

function roundedPath(points, radius) {
	const clean = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
	let d = `M ${clean[0].x} ${clean[0].y}`;

	for (let i = 1; i < clean.length - 1; i++) {
		const [before, corner, after] = [clean[i - 1], clean[i], clean[i + 1]];
		const first = { x: corner.x - before.x, y: corner.y - before.y };
		const second = { x: after.x - corner.x, y: after.y - corner.y };
		const firstLength = Math.hypot(first.x, first.y);
		const secondLength = Math.hypot(second.x, second.y);
		const r = Math.min(radius, firstLength / 2, secondLength / 2);
		const start = { x: corner.x - (first.x / firstLength) * r, y: corner.y - (first.y / firstLength) * r };
		const end = { x: corner.x + (second.x / secondLength) * r, y: corner.y + (second.y / secondLength) * r };
		d += ` L ${start.x} ${start.y} Q ${corner.x} ${corner.y} ${end.x} ${end.y}`;
	}

	const last = clean[clean.length - 1];
	return `${d} L ${last.x} ${last.y}`;
}

const definitionFor = (panel) => (panel.kind === 'operation' ? operationDefinitions.value.get(panel.type) : null);

function titleIcon(panel) {
	return definitionFor(panel)?.icon || panel.icon || 'extension';
}

const TRIGGERS = {
	event: { name: 'Event Hook', description: 'Triggers when an event happens in the project' },
	schedule: { name: 'Schedule (CRON)', description: 'Triggers at a scheduled time' },
	operation: { name: 'Another Flow', description: 'Triggers when another flow runs it' },
	webhook: { name: 'Webhook', description: 'Triggers on an incoming HTTP request' },
	manual: { name: 'Manual', description: 'Triggers on manual run within selected collection(s)' },
};

function kindLabel(panel) {
	if (panel.kind === 'trigger') return TRIGGERS[panel.type]?.name ?? humanize(panel.type);
	return definitionFor(panel)?.name ?? humanize(panel.type);
}

function descriptionFor(panel) {
	return panel.kind === 'trigger' ? (TRIGGERS[panel.type]?.description ?? '') : '';
}

const collectionLabel = (name) => collectionsStore.getCollection?.(name)?.name ?? humanize(name);

function rowsFor(panel) {
	const options = panel.options ?? {};

	if (panel.kind === 'trigger') {
		const rows = [];
		const collections = [options.collections].flat().filter(Boolean);
		if (collections.length) rows.push({ label: 'Collections', text: collections.map(collectionLabel).join(', ') });
		if (options.cron) rows.push({ label: 'Cron', text: String(options.cron) });
		if (options.method) rows.push({ label: 'Method', text: String(options.method) });
		if (options.type) rows.push({ label: 'Type', text: humanize(options.type) });
		const events = [options.scope].flat().filter(Boolean);
		if (events.length) rows.push({ label: 'Events', text: events.join(', ') });
		return rows;
	}

	const overview = definitionFor(panel)?.overview;
	if (typeof overview === 'function') {
		try {
			const result = overview(options, { flow: { id: props.graph?.flowId ?? props.graph?.flow?.id } });
			if (Array.isArray(result)) {
				return result
					.filter((row) => row && row.label)
					.map((row) => ({ label: String(row.label), text: Array.isArray(row.text) ? row.text.join(', ') : String(row.text ?? '') }));
			}
		} catch {
			// Fall through to the generic summary below.
		}
	}

	// The operation has no overview (or is not installed): show a short plain summary instead of raw JSON.
	return Object.entries(options)
		.filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) && value !== '')
		.slice(0, 3)
		.map(([key, value]) => ({ label: humanize(key), text: String(value) }));
}

const statusLabel = (status) => ({ active: 'Active', inactive: 'Inactive' })[status] ?? humanize(status);

function humanize(value) {
	return String(value ?? '')
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/^./, (character) => character.toUpperCase());
}
</script>

<style scoped>
.flow-graph {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
}

.graph-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	min-height: 64px;
	padding: 12px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.graph-actions {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-left: auto;
}

.graph-header p {
	margin: 4px 0 0;
	font-size: 13px;
}

.canvas-scroll {
	flex: 1;
	min-height: 0;
	overflow: auto;
	background-color: var(--theme--background);
}

.canvas {
	position: relative;
	min-width: 100%;
	min-height: 100%;
}

.edges {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.edge {
	stroke-width: 2;
}
.edge.resolve {
	stroke: var(--theme--primary);
}
.edge.reject {
	stroke: var(--theme--secondary);
}

.card {
	position: absolute;
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	background: var(--theme--background);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	color: var(--theme--foreground);
}

.card.trigger {
	border-color: var(--theme--primary);
}

.card.run-resolve {
	border-color: var(--theme--success);
}

.card.run-reject {
	border-color: var(--theme--danger);
	box-shadow: 0 0 0 6px color-mix(in srgb, var(--theme--danger) 22%, transparent);
}

.card.changed {
	border-style: dashed;
	border-color: var(--theme--warning);
}

.card.run-skipped {
	opacity: 0.45;
}

.run-mark {
	margin-left: auto;
	flex: none;
}

.run-mark.worked {
	color: var(--theme--success);
}

.run-mark.failed {
	color: var(--theme--danger);
}

.edge.skipped {
	opacity: 0.3;
}

.card-title {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 14px 0;
	color: var(--theme--primary);
	font-weight: 600;
	font-size: 15px;
}

.card-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.card-body {
	flex: 1;
	min-height: 0;
	overflow: hidden;
	padding: 6px 14px 10px;
	font-size: 14px;
}

.card-body p {
	margin: 0;
}

.kind {
	font-weight: 400;
}

.description {
	margin-top: 4px !important;
	font-weight: 600;
}

.rows {
	margin-top: 10px;
}

.row {
	margin-top: 10px;
}

.row-label {
	font-weight: 600;
}

.row-value {
	margin-top: 2px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--theme--foreground-subdued);
	font-family: var(--theme--fonts--monospace--font-family), monospace;
	font-size: 13px;
}

.card-status {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px;
	border-top: var(--theme--border-width) solid var(--theme--border-color-subdued);
	font-size: 14px;
}

.status-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--theme--primary);
}

.card-status.inactive .status-dot {
	background: var(--theme--foreground-subdued);
}

.handle {
	position: absolute;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	box-sizing: border-box;
	border-radius: 50%;
	background: var(--theme--background);
}

.handle.resolve {
	right: -10px;
	top: calc(10 * 18px - 10px);
	border: 2px solid var(--theme--primary);
	color: var(--theme--primary);
}

.handle.reject {
	right: -10px;
	top: calc(12 * 18px - 10px);
	border: 2px solid var(--theme--secondary);
	color: var(--theme--secondary);
}

.handle.input {
	left: -10px;
	top: calc(3.4 * 18px - 10px);
	border: 2px solid var(--theme--primary);
}

.handle .dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--theme--primary);
}

.card {
	cursor: pointer;
}

.card:hover,
.card:focus-visible {
	border-color: var(--theme--primary);
	outline: none;
}






.muted {
	color: var(--theme--foreground-subdued);
}
</style>
